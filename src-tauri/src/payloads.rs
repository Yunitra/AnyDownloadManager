use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct ProgressPayload {
    pub id: String,
    pub received: u64,
    pub total: u64,
    pub speed: u64,
}

#[derive(Serialize, Clone)]
pub struct StartedPayload {
    pub id: String,
    pub url: String,
    pub file_name: String,
    pub dest_dir: String,
    pub total: Option<u64>,
}

#[derive(Serialize, Clone)]
pub struct CompletedPayload {
    pub id: String,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct FailedPayload {
    pub id: String,
    pub error: String,
}

#[derive(Serialize, Clone)]
pub struct CanceledPayload {
    pub id: String,
}

#[derive(Serialize, Clone)]
pub struct ProbeResult {
    pub total: Option<u64>,
    pub file_name: String,
    pub category: String,
    pub download_dir: String,
}
