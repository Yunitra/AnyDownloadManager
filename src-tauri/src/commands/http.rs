use std::{
    fs::OpenOptions,
    io::{Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{Arc},
};

use futures_util::StreamExt;
use reqwest::header::{ACCEPT_RANGES, CONTENT_LENGTH, RANGE};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::{Emitter, State};
use tokio::time::{self, Duration, Instant};

use crate::payloads::{CanceledPayload, CompletedPayload, FailedPayload, ProgressPayload, StartedPayload};
use crate::state::{AppState, DownloadMeta};

#[tauri::command]
pub async fn resume_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    threads: Option<u8>,
) -> Result<(), String> {
    let meta = {
        let metas = state.metas.lock().map_err(|_| "State poisoned")?;
        metas.get(&id).cloned()
    }.ok_or_else(|| "unknown download id".to_string())?;

    if !meta.accept_ranges { return Err("server does not support range resuming".into()); }
    let total = meta.total.ok_or_else(|| "unknown total size; cannot resume".to_string())?;
    let cur = std::fs::metadata(&meta.temp).map(|m| m.len()).unwrap_or(0);
    if cur >= total {
        if meta.dest.exists() { let _ = std::fs::remove_file(&meta.dest); }
        std::fs::rename(&meta.temp, &meta.dest).map_err(|e| format!("Rename error: {}", e))?;
        let complete = CompletedPayload { id: id.clone(), path: meta.dest.to_string_lossy().to_string() };
        let _ = app.emit("download_completed", complete);
        let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
        let _ = state.metas.lock().map_err(|_| "State poisoned")?.remove(&id);
        return Ok(());
    }

    {
        let f = OpenOptions::new().create(true).write(true).open(&meta.temp)
            .map_err(|e| format!("Open temp error: {}", e))?;
        f.set_len(total).map_err(|e| format!("Pre-allocate error: {}", e))?;
    }

    let client = reqwest::Client::new();
    let threads = threads.unwrap_or(4).clamp(1, 32) as u64;
    let remaining = total.saturating_sub(cur);
    let chunk_size = (remaining + threads - 1) / threads;
    let downloaded = Arc::new(AtomicU64::new(cur));

    let cancel_flag = {
        let mut map = state.cancels.lock().map_err(|_| "State poisoned")?;
        let f = std::sync::Arc::new(AtomicBool::new(false));
        map.insert(id.clone(), f.clone());
        f
    };

    let app_for_ticker = app.clone();
    let id_for_ticker = id.clone();
    let mut last_bytes = cur;
    let mut last_instant = Instant::now();
    let ticker_downloaded = downloaded.clone();
    let ticker_cancel = cancel_flag.clone();
    let ticker = tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_millis(500));
        loop {
            interval.tick().await;
            let cur_now = ticker_downloaded.load(Ordering::Relaxed);
            let now = Instant::now();
            let delta = cur_now.saturating_sub(last_bytes);
            let elapsed = now.duration_since(last_instant).as_secs_f64().max(0.001);
            let speed = (delta as f64 / elapsed) as u64;
            let payload = ProgressPayload { id: id_for_ticker.clone(), received: cur_now, total, speed };
            let _ = app_for_ticker.emit("download_progress", payload);
            last_bytes = cur_now;
            last_instant = now;
            if cur_now >= total || ticker_cancel.load(Ordering::Relaxed) { break; }
        }
    });

    let mut tasks = Vec::new();
    for i in 0..threads {
        let start = cur + i * chunk_size;
        if start >= total { break; }
        let end = (start + chunk_size - 1).min(total - 1);
        let url = meta.url.clone();
        let temp_path = meta.temp.clone();
        let client_cloned = client.clone();
        let dl = downloaded.clone();
        let cancel = cancel_flag.clone();
        let t = tokio::spawn(async move {
            let range_header = format!("bytes={}-{}", start, end);
            let resp = client_cloned
                .get(&url)
                .header(RANGE, range_header)
                .send()
                .await
                .map_err(|e| format!("Range GET error: {}", e))?;
            if !resp.status().is_success() && resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("Unexpected status: {}", resp.status()));
            }
            let mut f = OpenOptions::new().write(true).open(&temp_path)
                .map_err(|e| format!("Open part file error: {}", e))?;
            f.seek(SeekFrom::Start(start)).map_err(|e| format!("Seek error: {}", e))?;
            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel.load(Ordering::Relaxed) { break; }
                let bytes = chunk.map_err(|e| format!("Read stream error: {}", e))?;
                f.write_all(&bytes).map_err(|e| format!("Write error: {}", e))?;
                dl.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            }
            Ok::<(), String>(())
        });
        tasks.push(t);
    }

    let mut any_err: Option<String> = None;
    for t in tasks { if let Err(e) = t.await.map_err(|e| format!("Join error: {}", e))? { any_err = Some(e); } }
    let _ = ticker.await;

    if cancel_flag.load(Ordering::Relaxed) {
        let _ = app.emit("download_canceled", CanceledPayload { id: id.clone() });
        let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
        return Err("canceled".into());
    }
    if let Some(err) = any_err { return Err(err); }

    if meta.dest.exists() { let _ = std::fs::remove_file(&meta.dest); }
    std::fs::rename(&meta.temp, &meta.dest).map_err(|e| format!("Rename error: {}", e))?;
    let complete = CompletedPayload { id: id.clone(), path: meta.dest.to_string_lossy().to_string() };
    let _ = app.emit("download_completed", complete);
    let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
    let _ = state.metas.lock().map_err(|_| "State poisoned")?.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    threads: u8,
    dest_dir: Option<String>,
    file_name: Option<String>,
) -> Result<String, String> {
    let threads = threads.clamp(1, 32) as u64;
    let client = reqwest::Client::new();

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

    let mut base_dir: PathBuf = if let Some(custom) = dest_dir {
        PathBuf::from(custom)
    } else {
        dirs::download_dir()
            .or_else(|| dirs::home_dir())
            .or_else(|| std::env::current_dir().ok())
            .ok_or_else(|| "Cannot resolve a writable directory".to_string())?
    };
    std::fs::create_dir_all(&base_dir).map_err(|e| format!("Create dir error: {}", e))?;
    base_dir.push(decided_name);
    let dest = base_dir;
    let mut temp = dest.clone();
    temp.set_extension("part");

    let id = format!("dl-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis());

    let started = StartedPayload {
        id: id.clone(),
        url: url.clone(),
        file_name: dest.file_name().and_then(|s| s.to_str()).unwrap_or("download.bin").to_string(),
        dest_dir: dest.parent().unwrap_or(std::path::Path::new("")).to_string_lossy().to_string(),
        total: len_opt,
    };
    let _ = app.emit("download_started", started);

    {
        let mut metas = state.metas.lock().map_err(|_| "State poisoned")?;
        metas.insert(id.clone(), DownloadMeta { url: url.clone(), dest: dest.clone(), temp: temp.clone(), total: len_opt, accept_ranges });
    }
    let cancel_flag = {
        let mut map = state.cancels.lock().map_err(|_| "State poisoned")?;
        let f = std::sync::Arc::new(AtomicBool::new(false));
        map.insert(id.clone(), f.clone());
        f
    };

    if len_opt.is_none() || !accept_ranges || threads == 1 {
        let resp = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("GET error: {}", e))?;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp)
            .map_err(|e| format!("Open file error: {}", e))?;
        let mut stream = resp.bytes_stream();
        let total = len_opt.unwrap_or(0);
        let mut received_all: u64 = 0;
        let mut last_instant = Instant::now();
        let mut last_bytes = 0u64;
        while let Some(chunk) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) { break; }
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
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = app.emit("download_canceled", CanceledPayload { id: id.clone() });
            let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
            return Err("canceled".into());
        }
        if dest.exists() { let _ = std::fs::remove_file(&dest); }
        std::fs::rename(&temp, &dest).map_err(|e| format!("Rename error: {}", e))?;
        let complete = CompletedPayload { id: id.clone(), path: dest.to_string_lossy().to_string() };
        let _ = app.emit("download_completed", complete);
        let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
        let _ = state.metas.lock().map_err(|_| "State poisoned")?.remove(&id);
        return Ok(dest.to_string_lossy().to_string());
    }

    let total = len_opt.ok_or_else(|| "Server didn't provide content length".to_string())?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&temp)
        .map_err(|e| format!("Open file error: {}", e))?;
    file.set_len(total)
        .map_err(|e| format!("Pre-allocate error: {}", e))?;
    drop(file);

    let chunk_size = (total + threads - 1) / threads;
    let downloaded = Arc::new(AtomicU64::new(0));
    let dl_for_ticker = downloaded.clone();

    let app_for_ticker = app.clone();
    let id_for_ticker = id.clone();
    let mut last_bytes = 0u64;
    let mut last_instant = Instant::now();
    let cancel_for_ticker = cancel_flag.clone();
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
            if cur >= total || cancel_for_ticker.load(Ordering::Relaxed) { break; }
        }
    });
    let mut tasks = Vec::new();
    for i in 0..threads {
        let start = i * chunk_size;
        if start >= total { break; }
        let end = (start + chunk_size - 1).min(total - 1);
        let url_cloned = url.clone();
        let temp_path = temp.clone();
        let client_cloned = client.clone();
        let downloaded_cloned = downloaded.clone();
        let cancel_clone = cancel_flag.clone();
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
                .open(&temp_path)
                .map_err(|e| format!("Open part file error: {}", e))?;
            f.seek(SeekFrom::Start(start))
                .map_err(|e| format!("Seek error: {}", e))?;

            let mut stream = resp.bytes_stream();
            while let Some(chunk) = stream.next().await {
                if cancel_clone.load(Ordering::Relaxed) { break; }
                let bytes = chunk.map_err(|e| format!("Read stream error: {}", e))?;
                f.write_all(&bytes)
                    .map_err(|e| format!("Write error: {}", e))?;
                downloaded_cloned.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            }
            Ok::<(), String>(())
        });
        tasks.push(t);
    }

    let mut any_err: Option<String> = None;
    for t in tasks {
        if let Err(e) = t.await.map_err(|e| format!("Join error: {}", e))? {
            any_err = Some(e);
        }
    }
    let _ = ticker.await;

    if cancel_flag.load(Ordering::Relaxed) {
        let _ = app.emit("download_canceled", CanceledPayload { id: id.clone() });
        let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
        return Err("canceled".into());
    }

    if let Some(err) = any_err {
        let payload = FailedPayload { id: id.clone(), error: err.clone() };
        let _ = app.emit("download_failed", payload);
        return Err(err);
    }

    if dest.exists() { let _ = std::fs::remove_file(&dest); }
    std::fs::rename(&temp, &dest).map_err(|e| format!("Rename error: {}", e))?;
    let complete = CompletedPayload { id: id.clone(), path: dest.to_string_lossy().to_string() };
    let _ = app.emit("download_completed", complete);
    let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
    let _ = state.metas.lock().map_err(|_| "State poisoned")?.remove(&id);
    Ok(dest.to_string_lossy().to_string())
}
