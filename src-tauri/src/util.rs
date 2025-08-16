pub fn guess_category_by_ext(name: &str) -> String {
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
