use tauri::State;
use reqwest::header::CONTENT_LENGTH;
use crate::state::AppState;
use crate::payloads::{ProbeResult};
use crate::util::guess_category_by_ext;

#[tauri::command]
pub async fn probe_url(url: String) -> Result<ProbeResult, String> {
    let client = reqwest::Client::new();
    let head = client
        .head(&url)
        .send()
        .await
        .map_err(|e| format!("HEAD error: {}", e))?;
    let total = head
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    // filename from URL
    let mut file_name = url
        .split('/')
        .last()
        .unwrap_or("download.bin")
        .split('?')
        .next()
        .unwrap_or("download.bin")
        .to_string();
    if file_name.is_empty() || file_name == "/" { file_name = "download.bin".into(); }
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
pub async fn cancel_download(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let flag = {
        let map = state.cancels.lock().map_err(|_| "State poisoned")?;
        map.get(&id).cloned()
    };
    if let Some(f) = flag { f.store(true, std::sync::atomic::Ordering::Relaxed); Ok(()) } else { Err("not found".into()) }
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
