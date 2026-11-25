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

/// Forwards a phone's `/nlp/…` request to this computer's language server: (method, path with
/// query, content type, body) → (status, content type, body).
pub type Nlp = Arc<
    dyn Fn(
            String,
            String,
            Option<Vec<u8>>,
            Vec<u8>,
        )
            -> std::pin::Pin<Box<dyn std::future::Future<Output = (u16, String, Vec<u8>)> + Send>>
        + Send
        + Sync,
>;

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
    nlp: Option<Nlp>,
    req: Request<Incoming>,
) -> Result<Response<Full<Bytes>>, std::convert::Infallible> {
    // A connected phone's language-server request: forwarded, so the phone can prepare a new
    // text while it is home (`/nlp/analyze/…` → the computer's own language server).
    if let (Some(nlp), Some(rest)) = (nlp, req.uri().path().strip_prefix("/nlp")) {
        let bearer = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::to_string);
        let allowed = lan
            .lock()
            .map(|l| l.authorized(bearer.as_deref()))
            .unwrap_or(false);
        if !allowed {
            return Ok(Response::builder()
                .status(401)
                .body(Full::new(Bytes::from_static(b"{\"ok\":false}")))
                .expect("response"));
        }
        let path = match req.uri().query() {
            Some(q) => format!("{rest}?{q}"),
            None => rest.to_string(),
        };
        let method = req.method().as_str().to_string();
        let ct = req
            .headers()
            .get("content-type")
            .map(|v| v.as_bytes().to_vec());
        let body = match Limited::new(req.into_body(), MAX_FILE + 1).collect().await {
            Ok(b) => b.to_bytes().to_vec(),
            Err(_) => vec![],
        };
        let (status, content_type, out) = nlp(method, path, ct, body).await;
        return Ok(Response::builder()
            .status(status)
            .header("content-type", content_type)
            .body(Full::new(Bytes::from(out)))
            .expect("response"));
    }
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
    nlp: Option<Nlp>,
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
            let (acceptor, lan, save_to, nlp) =
                (acceptor.clone(), lan.clone(), save_to.clone(), nlp.clone());
            tokio::spawn(async move {
                let Ok(tls) = acceptor.accept(tcp).await else {
                    return;
                };
                let service =
                    service_fn(move |req| answer(lan.clone(), save_to.clone(), nlp.clone(), req));
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

    #[tokio::test]
    async fn a_phone_pairs_and_syncs_over_pinned_https() {
        let dir = tempfile::tempdir().unwrap();
        let place = dir.path().join("place");
        fs::create_dir_all(&place).unwrap();
        let lan = Arc::new(Mutex::new(Lan::new(&place)));
        let code = lan.lock().unwrap().new_code(now());
        let (on, run) = listen(lan.clone(), dir.path(), 0, None, None)
            .await
            .unwrap();
        tokio::spawn(run);
        let base = format!("https://127.0.0.1:{}", on.port);

        let phone = crate::pinned::client(&on.fingerprint).unwrap();
        let paired: serde_json::Value = phone
            .post(format!("{base}/api/sync/pair"))
            .body(serde_json::json!({ "code": code, "name": "Pixel" }).to_string())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = paired["token"].as_str().unwrap().to_string();
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
        let (again, _) = listen(lan, dir.path(), 0, None, None).await.unwrap();
        assert_eq!(again.fingerprint, on.fingerprint);
    }

    #[tokio::test]
    async fn a_paired_phone_reaches_the_language_server_and_nobody_else() {
        let dir = tempfile::tempdir().unwrap();
        let place = dir.path().join("place");
        fs::create_dir_all(&place).unwrap();
        let lan = Arc::new(Mutex::new(Lan::new(&place)));
        let code = lan.lock().unwrap().new_code(now());
        let nlp: Nlp = Arc::new(|method, path, _ct, body| {
            Box::pin(async move {
                let echo = format!("{method} {path} {}", String::from_utf8_lossy(&body));
                (200, "text/plain".to_string(), echo.into_bytes())
            })
        });
        let (on, run) = listen(lan, dir.path(), 0, None, Some(nlp)).await.unwrap();
        tokio::spawn(run);
        let base = format!("https://127.0.0.1:{}", on.port);
        let phone = crate::pinned::client(&on.fingerprint).unwrap();
        let denied = phone
            .post(format!("{base}/nlp/analyze/text"))
            .send()
            .await
            .unwrap();
        assert_eq!(denied.status(), 401);
        let paired: serde_json::Value = phone
            .post(format!("{base}/api/sync/pair"))
            .body(serde_json::json!({ "code": code }).to_string())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let token = paired["token"].as_str().unwrap();
        let echo = phone
            .post(format!("{base}/nlp/analyze/text?x=1"))
            .bearer_auth(token)
            .body("hallo")
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert_eq!(echo, "POST /analyze/text?x=1 hallo");
    }
}
