use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, atomic::AtomicBool};

pub struct AppState {
    pub cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub metas: Mutex<HashMap<String, DownloadMeta>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self { cancels: Mutex::new(HashMap::new()), metas: Mutex::new(HashMap::new()) }
    }
}

#[derive(Clone)]
pub struct DownloadMeta {
    pub url: String,
    pub dest: PathBuf,
    pub temp: PathBuf,
    pub total: Option<u64>,
    pub accept_ranges: bool,
}
