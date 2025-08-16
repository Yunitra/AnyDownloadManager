// New modularized structure
mod state;
mod payloads;
mod util;
pub mod commands;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(crate::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            crate::commands::http::start_download,
            crate::commands::core::probe_url,
            crate::commands::core::delete_download,
            crate::commands::manic::start_download_manic,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
