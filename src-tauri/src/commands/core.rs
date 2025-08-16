use tauri::State;
use reqwest::header::{CONTENT_LENGTH, CONTENT_DISPOSITION, CONTENT_RANGE};
use crate::state::AppState;
use crate::payloads::{ProbeResult};
use crate::util::guess_category_by_ext;

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(10 + b - b'a'),
        b'A'..=b'F' => Some(10 + b - b'A'),
        _ => None,
    }
}

fn percent_decode_simple(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' { out.push(b' '); i += 1; continue; }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

fn filename_from_cd(cd: &str) -> Option<String> {
    let parts: Vec<&str> = cd.split(';').map(|s| s.trim()).collect();
    let mut filename_star: Option<String> = None;
    let mut filename: Option<String> = None;
    for p in parts {
        if let Some(rest) = p.strip_prefix("filename*=") {
            let v = rest.trim_matches('"');
            if let Some(pos) = v.find("''") {
                let enc = &v[pos + 2..];
                filename_star = Some(percent_decode_simple(enc));
            } else {
                filename_star = Some(percent_decode_simple(v));
            }
        } else if let Some(rest) = p.strip_prefix("filename=") {
            let mut v = rest.trim();
            if v.starts_with('"') && v.ends_with('"') && v.len() >= 2 { v = &v[1..v.len()-1]; }
            filename = Some(v.to_string());
        }
    }
    filename_star.or(filename)
}

#[tauri::command]
pub async fn probe_url(url: String) -> Result<ProbeResult, String> {
    let client = reqwest::Client::new();
    let head = client
        .head(&url)
        .send()
        .await
        .map_err(|e| format!("HEAD error: {}", e))?;
    let mut total = head
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    // filename from Content-Disposition if present; else from URL
    let mut file_name = if let Some(cd) = head.headers().get(CONTENT_DISPOSITION).and_then(|v| v.to_str().ok()) {
        filename_from_cd(cd).unwrap_or_else(|| {
            let raw = url.split('/').last().unwrap_or("download.bin").split('?').next().unwrap_or("download.bin");
            percent_decode_simple(raw)
        })
    } else {
        let raw = url.split('/').last().unwrap_or("download.bin").split('?').next().unwrap_or("download.bin");
        percent_decode_simple(raw)
    };
    if file_name.is_empty() || file_name == "/" { file_name = "download.bin".into(); }
    // If still not good, try a tiny ranged GET to follow redirects and grab headers
    if (!file_name.contains('.')) || file_name == "download.bin" || total.is_none() {
        if let Ok(resp) = client.get(&url).header(reqwest::header::RANGE, "bytes=0-0").send().await {
            if let Some(cd) = resp.headers().get(CONTENT_DISPOSITION).and_then(|v| v.to_str().ok()) {
                if let Some(n) = filename_from_cd(cd) { file_name = n; }
            }
            if total.is_none() {
                if let Some(cr) = resp.headers().get(CONTENT_RANGE).and_then(|v| v.to_str().ok()) {
                    if let Some(t) = cr.split('/').nth(1) { total = t.parse::<u64>().ok(); }
                }
            }
        }
    }
    let category = guess_category_by_ext(&file_name);
    let download_dir: String = dirs::download_dir()
        .or_else(|| dirs::home_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .to_string_lossy()
        .to_string();
    Ok(ProbeResult { total, file_name, category, download_dir })
}

#[tauri::command]
pub async fn delete_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    // cancel if running
    if let Ok(map) = state.cancels.lock() {
        if let Some(f) = map.get(&id) { f.store(true, std::sync::atomic::Ordering::Relaxed); }
    }
    // remove files if we have meta
    if let Ok(mut metas) = state.metas.lock() {
        if let Some(meta) = metas.remove(&id) {
            let _ = std::fs::remove_file(&meta.temp);
            // If a final file exists (rare if incomplete), remove it too
            let _ = std::fs::remove_file(&meta.dest);
        }
    }
    // remove cancel flag entry
    let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
    Ok(())
}
