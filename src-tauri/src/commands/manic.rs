use std::{
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    sync::Arc,
};
use std::sync::atomic::{AtomicBool, Ordering};

use indicatif::{ProgressBar, ProgressDrawTarget};
use manic::Downloader as ManicDownloader;
use tauri::{Emitter, State};
use tokio::time::{self, Duration, Instant};

use crate::payloads::{CanceledPayload, CompletedPayload, FailedPayload, ProgressPayload, StartedPayload};
use crate::state::{AppState, DownloadMeta};

#[tauri::command]
pub async fn start_download_manic(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
    threads: u8,
    dest_dir: Option<String>,
    file_name: Option<String>,
) -> Result<String, String> {
    let workers = threads.clamp(1, 32);

    // Initialize manic downloader
    let mut dl = ManicDownloader::new(&url, workers)
        .await
        .map_err(|e| format!("manic init error: {}", e))?;
    let total = dl.get_len();

    // Filename
    let decided_name = file_name.unwrap_or_else(|| dl.filename().to_string());

    // Destination directory
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

    // ID and started event
    let id = format!(
        "dl-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    );
    let started = StartedPayload {
        id: id.clone(),
        url: url.clone(),
        file_name: dest
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download.bin")
            .to_string(),
        dest_dir: dest
            .parent()
            .unwrap_or(std::path::Path::new(""))
            .to_string_lossy()
            .to_string(),
        total: Some(total),
    };
    let _ = app.emit("download_started", started);

    // Register state
    {
        let mut metas = state.metas.lock().map_err(|_| "State poisoned")?;
        metas.insert(
            id.clone(),
            DownloadMeta {
                url: url.clone(),
                dest: dest.clone(),
                temp: temp.clone(),
                total: Some(total),
                accept_ranges: true,
            },
        );
    }
    let cancel_flag = {
        let mut map = state.cancels.lock().map_err(|_| "State poisoned")?;
        let f = Arc::new(AtomicBool::new(false));
        map.insert(id.clone(), f.clone());
        f
    };

    // Progress reporting via hidden ProgressBar
    let pb = ProgressBar::new(total);
    pb.set_draw_target(ProgressDrawTarget::hidden());
    dl.connect_progress(pb.clone());

    let done_flag = Arc::new(AtomicBool::new(false));
    let done_for_ticker = done_flag.clone();
    let app_for_ticker = app.clone();
    let id_for_ticker = id.clone();
    let mut last_bytes: u64 = 0;
    let mut last_instant = Instant::now();
    let cancel_for_ticker = cancel_flag.clone();
    let progress_task = tokio::spawn(async move {
        let mut interval = time::interval(Duration::from_millis(500));
        loop {
            interval.tick().await;
            let cur = pb.position();
            let now = Instant::now();
            let delta = cur.saturating_sub(last_bytes);
            let elapsed = now.duration_since(last_instant).as_secs_f64().max(0.001);
            let speed = (delta as f64 / elapsed) as u64;
            let payload = ProgressPayload { id: id_for_ticker.clone(), received: cur, total, speed };
            let _ = app_for_ticker.emit("download_progress", payload);
            last_bytes = cur;
            last_instant = now;
            if done_for_ticker.load(Ordering::Relaxed)
                || cancel_for_ticker.load(Ordering::Relaxed)
                || cur >= total { break; }
        }
    });

    // Cancel watcher
    let cancel_watch = async {
        while !cancel_flag.load(Ordering::Relaxed) {
            time::sleep(Duration::from_millis(200)).await;
        }
    };

    // Download + write synchronously to avoid detached background IO
    let download_future = async {
        let data = dl.download().await.map_err(|e| format!("manic error: {}", e))?;
        let bytes = data.to_vec().await;
        let mut f = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&temp)
            .map_err(|e| format!("Open file error: {}", e))?;
        f.write_all(&bytes).map_err(|e| format!("Write error: {}", e))?;
        f.flush().map_err(|e| format!("Flush error: {}", e))?;
        if dest.exists() { let _ = std::fs::remove_file(&dest); }
        std::fs::rename(&temp, &dest).map_err(|e| format!("Rename error: {}", e))?;
        Ok::<(), String>(())
    };

    tokio::select! {
        res = download_future => {
            done_flag.store(true, Ordering::Relaxed);
            let _ = progress_task.await;
            if let Err(err) = res {
                let payload = FailedPayload { id: id.clone(), error: err.clone() };
                let _ = app.emit("download_failed", payload);
                return Err(err);
            }
            let complete = CompletedPayload { id: id.clone(), path: dest.to_string_lossy().to_string() };
            let _ = app.emit("download_completed", complete);
            let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
            let _ = state.metas.lock().map_err(|_| "State poisoned")?.remove(&id);
            Ok(dest.to_string_lossy().to_string())
        }
        _ = cancel_watch => {
            done_flag.store(true, Ordering::Relaxed);
            let _ = progress_task.await;
            let _ = app.emit("download_canceled", CanceledPayload { id: id.clone() });
            let _ = state.cancels.lock().map_err(|_| "State poisoned")?.remove(&id);
            Err("canceled".into())
        }
    }
}
