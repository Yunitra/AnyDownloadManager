use std::{
    fs::OpenOptions,
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_LENGTH, RANGE};
use serde::Serialize;
use std::sync::{Arc, atomic::{AtomicU64, Ordering}};
use tokio::time::{self, Duration, Instant};
use tauri::Emitter;

#[derive(Serialize, Clone)]
struct ProgressPayload {
    id: String,
    received: u64,
    total: u64,
    speed: u64,
}

#[derive(Serialize, Clone)]
struct StartedPayload {
    id: String,
    url: String,
    file_name: String,
    total: Option<u64>,
}

#[derive(Serialize, Clone)]
struct CompletedPayload {
    id: String,
    path: String,
}

#[derive(Serialize, Clone)]
struct FailedPayload {
    id: String,
    error: String,
}

#[derive(Serialize, Clone)]
struct ProbeResult {
    total: Option<u64>,
    file_name: String,
    category: String,
    download_dir: String,
}

fn guess_category_by_ext(name: &str) -> String {
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let image = ["png","jpg","jpeg","gif","bmp","webp","svg","heic","tiff"]; // Image
    let music = ["mp3","flac","aac","wav","ogg","m4a"]; // Music
    let video = ["mp4","mkv","avi","mov","webm","flv","wmv","m4v"]; // Video
    let apps = ["exe","msi","apk","dmg","pkg","deb","rpm","AppImage"]; // Apps
    let document = ["pdf","doc","docx","xls","xlsx","ppt","pptx","txt","md","rtf"]; // Document
    let compressed = ["zip","rar","7z","tar","gz","bz2","xz","zst"]; // Compressed
    if image.contains(&ext.as_str()) { return "image".into(); }
    if music.contains(&ext.as_str()) { return "music".into(); }
    if video.contains(&ext.as_str()) { return "video".into(); }
    if apps.contains(&ext.as_str()) { return "apps".into(); }
    if document.contains(&ext.as_str()) { return "document".into(); }
    if compressed.contains(&ext.as_str()) { return "compressed".into(); }
    "other".into()
}

#[tauri::command]
async fn probe_url(url: String) -> Result<ProbeResult, String> {
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
async fn start_download(
    app: tauri::AppHandle,
    url: String,
    threads: u8,
    dest_dir: Option<String>,
    file_name: Option<String>,
) -> Result<String, String> {
    let threads = threads.clamp(1, 32) as u64;
    let client = reqwest::Client::new();

    // Probe with HEAD
    let head = client
        .head(&url)
        .send()
        .await
        .map_err(|e| format!("HEAD error: {}", e))?;

    let len_opt = head
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok());
    let accept_ranges = head
        .headers()
        .get(ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase()
        .contains("bytes");

    // Decide filename
    let mut decided_name = file_name.unwrap_or_else(|| {
        let mut name = url
            .split('/')
            .last()
            .unwrap_or("download.bin")
            .split('?')
            .next()
            .unwrap_or("download.bin")
            .to_string();
        if name.is_empty() || name == "/" { name = "download.bin".into(); }
        name
    });
    if decided_name.is_empty() { decided_name = "download.bin".into(); }

    // Destination directory: use provided or fallback
    let mut base_dir: PathBuf = if let Some(custom) = dest_dir {
        PathBuf::from(custom)
    } else {
        dirs::download_dir()
            .or_else(|| dirs::home_dir())
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| "Cannot resolve a writable directory".to_string())?
    };
    // Ensure directory exists
    std::fs::create_dir_all(&base_dir).map_err(|e| format!("Create dir error: {}", e))?;
    base_dir.push(decided_name);
    let dest = base_dir;

    // Generate a simple ID (millis since epoch)
    let id = format!("dl-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());

    // Emit started
    let started = StartedPayload { id: id.clone(), url: url.clone(), file_name: dest.file_name().and_then(|s| s.to_str()).unwrap_or("download.bin").to_string(), total: len_opt };
    let _ = app.emit("download_started", started);

    // If content length or ranges unavailable, do single-thread download
    if len_opt.is_none() || (!accept_ranges && threads == 1) {
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("GET error: {}", e))?;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&dest)
            .map_err(|e| format!("Open file error: {}", e))?;
        let mut stream = resp.bytes_stream();
        let total = len_opt.unwrap_or(0);
        let mut received_all: u64 = 0;
        let mut last_instant = Instant::now();
        let mut last_bytes = 0u64;
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.map_err(|e| format!("Read stream error: {}", e))?;
            file.write_all(&bytes)
                .map_err(|e| format!("Write error: {}", e))?;
            received_all += bytes.len() as u64;
            let now = Instant::now();
            if now.duration_since(last_instant) >= Duration::from_millis(400) {
                let delta = received_all.saturating_sub(last_bytes);
                let elapsed = now.duration_since(last_instant).as_secs_f64().max(0.001);
                let speed = (delta as f64 / elapsed) as u64;
                let payload = ProgressPayload { id: id.clone(), received: received_all, total, speed };
                let _ = app.emit("download_progress", payload);
                last_instant = now;
                last_bytes = received_all;
            }
        }
        let complete = CompletedPayload { id: id.clone(), path: dest.to_string_lossy().to_string() };
        let _ = app.emit("download_completed", complete);
        return Ok(dest.to_string_lossy().to_string());
    }

    let total = len_opt.ok_or_else(|| "Server didn't provide content length".to_string())?;
    // Pre-allocate file
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&dest)
        .map_err(|e| format!("Open file error: {}", e))?;
    file.set_len(total)
        .map_err(|e| format!("Pre-allocate error: {}", e))?;
    drop(file);

    let chunk_size = (total + threads - 1) / threads;
    let downloaded = Arc::new(AtomicU64::new(0));
    let dl_for_ticker = downloaded.clone();

    // Progress ticker
    let app_for_ticker = app.clone();
    let id_for_ticker = id.clone();
    let mut last_bytes = 0u64;
    let mut last_instant = Instant::now();
    let ticker = tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_millis(500));
        loop {
            interval.tick().await;
            let cur = dl_for_ticker.load(Ordering::Relaxed);
            let now = Instant::now();
            let delta = cur.saturating_sub(last_bytes);
            let elapsed = now.duration_since(last_instant).as_secs_f64().max(0.001);
            let speed = (delta as f64 / elapsed) as u64;
            let payload = ProgressPayload { id: id_for_ticker.clone(), received: cur, total, speed };
            let _ = app_for_ticker.emit("download_progress", payload);
            last_bytes = cur;
            last_instant = now;
            if cur >= total { break; }
        }
    });
    let mut tasks = Vec::new();
    for i in 0..threads {
        let start = i * chunk_size;
        if start >= total { break; }
        let end = (start + chunk_size - 1).min(total - 1);
        let url_cloned = url.clone();
        let dest_path = dest.clone();
        let client_cloned = client.clone();
        let downloaded_cloned = downloaded.clone();
        let t = tokio::spawn(async move {
            let range_header = format!("bytes={}-{}", start, end);
            let resp = client_cloned
                .get(&url_cloned)
                .header(RANGE, range_header)
                .send()
                .await
                .map_err(|e| format!("Range GET error: {}", e))?;
            if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("Unexpected status: {}", resp.status()));
            }

            let mut f = OpenOptions::new()
                .write(true)
                .open(&dest_path)
                .map_err(|e| format!("Open part file error: {}", e))?;
            f.seek(SeekFrom::Start(start))
                .map_err(|e| format!("Seek error: {}", e))?;

            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|e| format!("Read stream error: {}", e))?;
                f.write_all(&bytes)
                    .map_err(|e| format!("Write error: {}", e))?;
                downloaded_cloned.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            }
            Ok::<(), String>(())
        });
        tasks.push(t);
    }

    // Wait all
    let mut any_err: Option<String> = None;
    for t in tasks {
        if let Err(e) = t.await.map_err(|e| format!("Join error: {}", e))? {
            any_err = Some(e);
        }
    }
    // Ensure ticker stops
    let _ = ticker.await;

    if let Some(err) = any_err {
        let payload = FailedPayload { id: id.clone(), error: err.clone() };
        let _ = app.emit("download_failed", payload);
        return Err(err);
    }

    let complete = CompletedPayload { id: id.clone(), path: dest.to_string_lossy().to_string() };
    let _ = app.emit("download_completed", complete);
    Ok(dest.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_download, probe_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
