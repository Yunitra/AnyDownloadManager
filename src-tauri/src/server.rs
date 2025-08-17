use std::thread;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use serde::Deserialize;

#[derive(Deserialize)]
struct AddReq {
  url: String,
}

pub fn start_bridge(app: AppHandle) {
  // Spawn a lightweight thread HTTP server on localhost
  thread::spawn(move || {
    let server = match Server::http("127.0.0.1:47891") {
      Ok(s) => s,
      Err(e) => {
        eprintln!("ADM bridge server failed to bind: {e}");
        return;
      }
    };

    for mut req in server.incoming_requests() {
      let method = req.method().clone();
      let path = req.url().to_string();

      // CORS preflight
      if method == Method::Options && path == "/add" {
        let resp = Response::from_string("")
          .with_status_code(StatusCode(204))
          .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
          .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"Content-Type").unwrap())
          .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"POST, OPTIONS").unwrap());
        let _ = req.respond(resp);
        continue;
      }

      if method == Method::Post && path == "/add" {
        let mut body = String::new();
        let _ = req.as_reader().read_to_string(&mut body);
        let parsed: Result<AddReq, _> = serde_json::from_str(&body);
        if let Ok(p) = parsed {
          let _ = app.emit("adm-add-from-bridge", p.url);
        }
        let resp = Response::from_string("OK")
          .with_status_code(StatusCode(200))
          .with_header(Header::from_bytes(b"Access-Control-Allow-Origin", b"*").unwrap())
          .with_header(Header::from_bytes(b"Access-Control-Allow-Headers", b"Content-Type").unwrap())
          .with_header(Header::from_bytes(b"Access-Control-Allow-Methods", b"POST, OPTIONS").unwrap());
        let _ = req.respond(resp);
      } else {
        let _ = req.respond(
          Response::from_string("Not Found").with_status_code(StatusCode(404))
        );
      }
    }
  });
}
