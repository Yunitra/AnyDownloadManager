// New modularized structure
pub mod commands;
mod payloads;
mod state;
mod util;
mod server;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(crate::state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            crate::commands::http::start_download,
            crate::commands::core::probe_url,
            crate::commands::core::delete_download,
            crate::commands::manic::start_download_manic,
        ]);

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
            println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
            // when defining deep link schemes at runtime, also check `argv` here
        }));
    }

    builder = builder.plugin(tauri_plugin_deep_link::init());

    builder = builder.setup(|app| {
        // Start localhost HTTP bridge for Chrome extension
        crate::server::start_bridge(app.handle().clone());
        Ok(())
    });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
