use std::net::ToSocketAddrs;
use tauri::Emitter;
use tiny_http::{Server, Response, Request};

pub fn start_http_bridge(app: tauri::AppHandle) {
    // Bind to 127.0.0.1:21234, retry a few times if in use
    let addr = ("127.0.0.1", 21234).to_socket_addrs().ok().and_then(|mut it| it.next());
    let Some(addr) = addr else { return; };

    let server = match Server::http(addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("ADM http bridge failed to start: {e}");
            return;
        }
    };

    for req in server.incoming_requests() {
        handle_request(&app, req);
    }
}

fn handle_request(app: &tauri::AppHandle, req: Request) {
    let url = req.url().to_string(); // like "/add?url=..."
    if url.starts_with("/add") || url.starts_with("/v1/add") {
        let url_param = extract_query_param(&url, "url").unwrap_or_default();
        if !url_param.is_empty() {
            let _ = app.emit("adm-bridge-add-url", url_param);
        }
        let _ = req.respond(Response::from_string("OK"));
        return;
    }

    let _ = req.respond(Response::from_string("Not Found").with_status_code(404));
}

fn extract_query_param(url: &str, key: &str) -> Option<String> {
    let Some(idx) = url.find('?') else { return None; };
    let qs = &url[idx + 1..];
    for pair in qs.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next().unwrap_or("");
        let v = it.next().unwrap_or("");
        if k == key {
            return urlencoding::decode(v).ok().map(|s| s.into_owned());
        }
    }
    None
}
