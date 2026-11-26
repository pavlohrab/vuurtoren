//! An HTTPS client that trusts exactly one certificate: the one whose SHA-256 came in the QR code
//! of "Connect a phone" (SY1). No certificate authority, no warning, and the computer's address
//! may change: only the certificate counts. Used by the phone to reach its computer.

use std::sync::Arc;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, SignatureScheme};
use sha2::{Digest, Sha256};

/// The SHA-256 of a certificate, as lowercase hex (what the QR code carries).
pub fn fingerprint(cert_der: &[u8]) -> String {
    Sha256::digest(cert_der)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Debug)]
struct Pinned {
    sha256: String,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if fingerprint(end_entity) == self.sha256 {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "This is not the computer from the code. Show a new code on it and scan again."
                    .into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// A client for the computer with certificate fingerprint `sha256` (hex).
pub fn client(sha256: &str) -> Result<reqwest::Client, String> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned {
            sha256: sha256.to_lowercase(),
            provider,
        }))
        .with_no_client_auth();
    reqwest::Client::builder()
        .use_preconfigured_tls(config)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}

/// Accepts any certificate and remembers which one it saw: the first step of the typed code (SY9),
/// before the phone knows the computer's certificate. Nothing but the proof request goes over it.
#[derive(Debug)]
struct Seen {
    seen: Arc<std::sync::Mutex<Option<String>>>,
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for Seen {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if let Ok(mut s) = self.seen.lock() {
            *s = Some(fingerprint(end_entity));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Is `host` an address on a home network (private IPv4)? The typed code only goes there.
pub fn home_network(host: &str) -> bool {
    match host.parse::<std::net::Ipv4Addr>() {
        Ok(ip) => ip.is_private() || ip.is_link_local(),
        Err(_) => false,
    }
}

/// Ask the computer at `base` (https://<home address>:<port>) to prove it knows the code, for
/// `nonce`. Returns the certificate it showed and its proof; the page checks the proof.
pub async fn probe(base: &str, nonce: &str) -> Result<(String, String), String> {
    let url = reqwest::Url::parse(base).map_err(|_| "Not an address.".to_string())?;
    if url.scheme() != "https" || !url.host_str().is_some_and(home_network) {
        return Err(
            "Type the address your computer shows: it starts with 192.168, 10 or 172.".into(),
        );
    }
    let seen = Arc::new(std::sync::Mutex::new(None));
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider.clone())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Seen {
            seen: seen.clone(),
            provider,
        }))
        .with_no_client_auth();
    let client = reqwest::Client::builder()
        .use_preconfigured_tls(config)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{}/api/sync/prove", base.trim_end_matches('/')))
        .body(serde_json::json!({ "nonce": nonce }).to_string())
        .send()
        .await
        .map_err(|_| "Your phone can't reach the computer at that address.".to_string())?;
    let status = res.status();
    let v: serde_json::Value = res.json().await.unwrap_or_default();
    if !status.is_success() {
        return Err(v["error"]
            .as_str()
            .unwrap_or("The computer didn't take the code.")
            .to_string());
    }
    let proof = v["proof"].as_str().unwrap_or("").to_string();
    let print = seen.lock().ok().and_then(|s| s.clone()).unwrap_or_default();
    Ok((print, proof))
}

#[cfg(test)]
mod tests {
    use super::home_network;

    #[test]
    fn the_typed_code_goes_only_to_a_home_network() {
        for ok in ["192.168.178.123", "10.0.0.5", "172.20.1.1", "169.254.3.4"] {
            assert!(home_network(ok), "{ok}");
        }
        for no in ["8.8.8.8", "127.0.0.1", "vuurtoren.app", "172.32.0.1"] {
            assert!(!home_network(no), "{no}");
        }
    }
}
