//! The `vuurtoren-nlp:` protocol: the web app's way to the bundled language server.
//!
//! The page fetches `vuurtoren-nlp://localhost/<path>` (Windows: `http://vuurtoren-nlp.localhost/`);
//! this handler forwards the request to the sidecar on 127.0.0.1 with the secret token, so the
//! token never reaches JavaScript and no CORS setup is needed on the Python side. While the
//! sidecar is still starting, requests wait for it; analysis also waits (up to a minute and a
//! half) while the dictionary pack is being downloaded, so the first texts get dictionary lemmas.

use std::time::{Duration, Instant};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::sidecar::{NlpState, TOKEN_HEADER};

pub const SCHEME: &str = "vuurtoren-nlp";
/// How long a request waits for the sidecar to come up.
const WAIT_START: Duration = Duration::from_secs(120);
/// How long `/analyze/...` waits for the dictionary download (the client gives up at 120 s).
const WAIT_DICTIONARY: Duration = Duration::from_secs(90);
/// Long jobs (PDF, translation of a whole book) are bounded by the web client's own timeout.
const FORWARD_TIMEOUT: Duration = Duration::from_secs(600);

/// The address the web app uses as its language server (`nlpBase` in `desktop_info`).
pub fn base_url() -> &'static str {
    if cfg!(windows) {
        "http://vuurtoren-nlp.localhost"
    } else {
        "vuurtoren-nlp://localhost"
    }
}

/// Only the app's own pages may use the language server. Any other site the window might show
/// sends its http(s) origin and is refused.
/// Custom-scheme pages report `tauri://localhost` or an opaque `null` origin.
pub fn origin_allowed(origin: Option<&str>, home: &str) -> bool {
    match origin {
        None | Some("null") => true,
        Some(o) => o == home || o.starts_with("tauri://"),
    }
}

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(body)
        .expect("valid response")
}

fn detail(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = serde_json::json!({ "detail": message }).to_string();
    reply(status, "application/json", body.into_bytes())
}

/// The part of the URL after the host: `/analyze/text?x=1`.
pub fn upstream_path(req: &Request<Vec<u8>>) -> String {
    req.uri()
        .path_and_query()
        .map(|p| p.as_str().to_string())
        .unwrap_or_else(|| "/".into())
}

pub async fn handle(app: AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    if !origin_allowed(origin, &crate::home_origin(&app)) {
        return detail(StatusCode::FORBIDDEN, "Not allowed from this page.");
    }
    if req.method() == tauri::http::Method::OPTIONS {
        return Response::builder()
            .status(StatusCode::NO_CONTENT)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST")
            .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "content-type")
            .header(header::ACCESS_CONTROL_MAX_AGE, "600")
            .body(vec![])
            .expect("valid response");
    }
    let state = app.state::<crate::State>();
    crate::desktop::ensure_sidecar(&app);
    let started = Instant::now();
    loop {
        match state.sidecar.state() {
            NlpState::Ready => break,
            NlpState::Starting | NlpState::Idle if started.elapsed() < WAIT_START => {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            NlpState::Missing => {
                return detail(
                    StatusCode::BAD_GATEWAY,
                    "This build of Vuurtoren has no language server.",
                )
            }
            NlpState::Failed { error } => return detail(StatusCode::BAD_GATEWAY, &error),
            _ => {
                return detail(
                    StatusCode::GATEWAY_TIMEOUT,
                    "The language server is still starting. Try again in a moment.",
                )
            }
        }
    }
    let path = upstream_path(&req);
    if path.starts_with("/analyze/") {
        let waiting = Instant::now();
        while state.sidecar.dictionary_busy() && waiting.elapsed() < WAIT_DICTIONARY {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Some(h) = state.sidecar.fetch_health(&state.client).await {
                *state.sidecar.health.lock().unwrap() = Some(h);
            }
        }
    }
    let Some(base) = state.sidecar.base() else {
        return detail(
            StatusCode::BAD_GATEWAY,
            "The language server is not running.",
        );
    };
    let method = match req.method().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        _ => return detail(StatusCode::METHOD_NOT_ALLOWED, "Only GET and POST."),
    };
    let mut forward = state
        .client
        .request(method, format!("{base}{path}"))
        .header(TOKEN_HEADER, &state.sidecar.token)
        .timeout(FORWARD_TIMEOUT);
    if let Some(ct) = req.headers().get(header::CONTENT_TYPE) {
        forward = forward.header(reqwest::header::CONTENT_TYPE, ct.as_bytes());
    }
    let res = match forward.body(req.into_body()).send().await {
        Ok(res) => res,
        Err(e) => {
            return detail(
                if e.is_timeout() {
                    StatusCode::GATEWAY_TIMEOUT
                } else {
                    StatusCode::BAD_GATEWAY
                },
                &format!("The language server did not answer: {e}"),
            )
        }
    };
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    match res.bytes().await {
        Ok(body) => reply(status, &content_type, body.to_vec()),
        Err(e) => detail(StatusCode::BAD_GATEWAY, &format!("Incomplete answer: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_apps_own_pages() {
        let home = "tauri://localhost";
        assert!(origin_allowed(None, home));
        assert!(origin_allowed(Some("null"), home));
        assert!(origin_allowed(Some("tauri://localhost"), home));
        assert!(origin_allowed(
            Some("http://tauri.localhost"),
            "http://tauri.localhost"
        ));
        assert!(!origin_allowed(Some("https://vuurtoren.example.com"), home));
        assert!(!origin_allowed(Some("http://localhost:5173"), home));
        assert!(!origin_allowed(
            Some("http://tauri.localhost.evil.com"),
            "http://tauri.localhost"
        ));
    }

    #[test]
    fn path_and_query_are_forwarded() {
        let req = Request::builder()
            .uri("vuurtoren-nlp://localhost/grammar/examples?topic=x&limit=3")
            .body(vec![])
            .unwrap();
        assert_eq!(upstream_path(&req), "/grammar/examples?topic=x&limit=3");
        let win = Request::builder()
            .uri("http://vuurtoren-nlp.localhost/health")
            .body(vec![])
            .unwrap();
        assert_eq!(upstream_path(&win), "/health");
    }
}
