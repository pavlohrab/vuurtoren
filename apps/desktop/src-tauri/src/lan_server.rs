//! The HTTPS listener of "Connect a phone" (SY1): serves [`crate::lan::Lan`] to the phones on the
//! home network. The certificate is self-signed, made once and kept in the app's data folder; the
//! phone pins its SHA-256 from the QR code ([`crate::pinned`]), so no certificate authority is
//! needed and the computer's address may change. Computers only.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use tauri::Url;
use tokio::net::TcpListener;
use tokio_rustls::TlsAcceptor;

use crate::lan::{Lan, MAX_FILE};
use crate::pinned::fingerprint;

const CERT: &str = "lan-cert.der";
const KEY: &str = "lan-key.der";

/// The certificate and its key: read from `dir`, or made and kept there the first time.
pub fn certificate(dir: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let (cert, key) = (dir.join(CERT), dir.join(KEY));
    if let (Ok(c), Ok(k)) = (fs::read(&cert), fs::read(&key)) {
        return Ok((c, k));
    }
    let made = rcgen::generate_simple_self_signed(vec!["vuurtoren.local".to_string()])
        .map_err(|e| e.to_string())?;
    let c = made.cert.der().to_vec();
    let k = made.key_pair.serialize_der();
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(&cert, &c).map_err(|e| e.to_string())?;
    fs::write(&key, &k).map_err(|e| e.to_string())?;
    Ok((c, k))
}

/// The listener: its port and the certificate's fingerprint (both go in the QR code).
pub struct Listening {
    pub port: u16,
    pub fingerprint: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

async fn answer(
    lan: Arc<Mutex<Lan>>,
    save_to: Option<Arc<std::path::PathBuf>>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    let method = req.method().as_str().to_string();
    let url = Url::parse(&format!("https://phone{}", req.uri())).ok();
    let path = url
        .as_ref()
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    let query: HashMap<String, String> = url
        .as_ref()
        .map(|u| u.query_pairs().into_owned().collect())
        .unwrap_or_default();
    let bearer = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::to_string);
    let body = match Limited::new(req.into_body(), MAX_FILE + 1).collect().await {
        Ok(b) => b.to_bytes(),
        Err(_) => {
            return Ok(Response::builder()
                .status(413)
                .body(Full::new(Bytes::from_static(b"{\"ok\":false}")))
                .expect("response"))
        }
    };
    let reply = match lan.lock() {
        Ok(mut lan) => {
            let reply = lan.dispatch(&method, &path, &query, bearer.as_deref(), &body, now());
            // A phone paired or claimed its folder: keep the phones for the next start.
            if let Some(file) = save_to.as_deref() {
                if lan.take_dirty() {
                    let _ = fs::write(file, lan.phones_json().to_string());
                }
            }
            reply
        }
        Err(_) => crate::lan::Reply {
            status: 500,
            content_type: "application/json",
            body: b"{\"ok\":false}".to_vec(),
        },
    };
    Ok(Response::builder()
        .status(reply.status)
        .header("content-type", reply.content_type)
        .header("cache-control", "no-store")
        .body(Full::new(Bytes::from(reply.body)))
        .expect("response"))
}

/// Listen on `port` (0: any free one) on every network interface, serving `lan`. The returned
/// future runs the listener until it is dropped.
pub async fn listen(
    lan: Arc<Mutex<Lan>>,
    data_dir: &Path,
    port: u16,
    save_to: Option<std::path::PathBuf>,
) -> Result<(Listening, impl std::future::Future<Output = ()>), String> {
    let (cert, key) = certificate(data_dir)?;
    let print = fingerprint(&cert);
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(cert)],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key)),
        )
        .map_err(|e| e.to_string())?;
    let acceptor = TlsAcceptor::from(Arc::new(config));
    // The port asked for (the fixed one, so a firewall rule stays right), else any free one.
    let listener = match TcpListener::bind(("0.0.0.0", port)).await {
        Ok(l) => l,
        Err(_) if port != 0 => TcpListener::bind(("0.0.0.0", 0))
            .await
            .map_err(|e| format!("Could not listen for phones: {e}"))?,
        Err(e) => return Err(format!("Could not listen on port {port}: {e}")),
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let save_to = save_to.map(Arc::new);
    let run = async move {
        loop {
            let Ok((tcp, _)) = listener.accept().await else {
                continue;
            };
            let (acceptor, lan, save_to) = (acceptor.clone(), lan.clone(), save_to.clone());
            tokio::spawn(async move {
                let Ok(tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let service = service_fn(move |req| answer(lan.clone(), save_to.clone(), req));
                let _ = http1::Builder::new()
                    .serve_connection(TokioIo::new(tls), service)
                    .await;
            });
        }
    };
    Ok((
        Listening {
            port,
            fingerprint: print,
        },
        run,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pair over HTTPS as a phone does: the code, the computer's yes (SY12), the token.
    async fn pair(
        phone: &reqwest::Client,
        base: &str,
        lan: &Arc<Mutex<Lan>>,
        code: &str,
    ) -> String {
        let asked: serde_json::Value = phone
            .post(format!("{base}/api/sync/pair"))
            .body(serde_json::json!({ "code": code, "name": "Pixel" }).to_string())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let id = asked["waiting"].as_str().unwrap().to_string();
        assert!(lan.lock().unwrap().answer(&id, true));
        let paired: serde_json::Value = phone
            .post(format!("{base}/api/sync/pair/wait"))
            .body(serde_json::json!({ "waiting": id }).to_string())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        paired["token"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn a_phone_pairs_and_syncs_over_pinned_https() {
        let dir = tempfile::tempdir().unwrap();
        let place = dir.path().join("place");
        fs::create_dir_all(&place).unwrap();
        let lan = Arc::new(Mutex::new(Lan::new(&place)));
        let code = lan.lock().unwrap().new_code(now());
        let (on, run) = listen(lan.clone(), dir.path(), 0, None).await.unwrap();
        tokio::spawn(run);
        let base = format!("https://127.0.0.1:{}", on.port);

        let phone = crate::pinned::client(&on.fingerprint).unwrap();
        let token = pair(&phone, &base, &lan, &code).await;
        let put = phone
            .put(format!(
                "{base}/api/sync/file?path=vuurtoren/devices/p1/a.kan"
            ))
            .bearer_auth(&token)
            .body("sealed")
            .send()
            .await
            .unwrap();
        assert_eq!(put.status(), 200);
        let list: serde_json::Value = phone
            .get(format!("{base}/api/sync/list?dir=vuurtoren/devices"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(list["names"], serde_json::json!(["p1"]));

        // Another certificate (another computer, or someone in between): refused.
        let wrong = crate::pinned::client(&"0".repeat(64)).unwrap();
        assert!(wrong
            .get(format!("{base}/api/health"))
            .send()
            .await
            .is_err());

        // The certificate is kept: the same fingerprint next time.
        let (again, _) = listen(lan, dir.path(), 0, None).await.unwrap();
        assert_eq!(again.fingerprint, on.fingerprint);
    }

    /// SY6: the computer is no language server for its phone; a phone adds no texts.
    #[tokio::test]
    async fn the_language_server_is_not_forwarded_even_for_a_paired_phone() {
        let dir = tempfile::tempdir().unwrap();
        let place = dir.path().join("place");
        fs::create_dir_all(&place).unwrap();
        let lan = Arc::new(Mutex::new(Lan::new(&place)));
        let code = lan.lock().unwrap().new_code(now());
        let (on, run) = listen(lan.clone(), dir.path(), 0, None).await.unwrap();
        tokio::spawn(run);
        let base = format!("https://127.0.0.1:{}", on.port);
        let phone = crate::pinned::client(&on.fingerprint).unwrap();
        let token = pair(&phone, &base, &lan, &code).await;
        let res = phone
            .post(format!("{base}/nlp/analyze/text"))
            .bearer_auth(&token)
            .body("hallo")
            .send()
            .await
            .unwrap();
        assert!(!res.status().is_success());
    }
}
