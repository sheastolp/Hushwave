use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

#[derive(Serialize)]
struct SoundGenerationRequest {
    text: String,
    #[serde(rename = "loop")]
    loop_audio: bool,
    duration_seconds: f64,
    prompt_influence: f64,
}

/// Calls the ElevenLabs Sound Effects API (POST /v1/sound-generation) with the caller's own
/// API key and returns the generated MP3 as a base64 string. Runs from Rust, not the browser,
/// so it isn't subject to the WebView's CORS restrictions and the key never touches an
/// uncontrolled network layer.
#[tauri::command]
async fn generate_sound_effect(
    text: String,
    api_key: String,
    duration_seconds: f64,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No ElevenLabs API key configured.".into());
    }
    if text.trim().is_empty() {
        return Err("Prompt text is empty.".into());
    }

    let body = SoundGenerationRequest {
        text,
        loop_audio: true,
        duration_seconds: duration_seconds.clamp(0.5, 30.0),
        prompt_influence: 0.35,
    };

    let client = reqwest::Client::new();
    let response = client
        .post("https://api.elevenlabs.io/v1/sound-generation")
        .header("xi-api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request to ElevenLabs failed: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .unwrap_or_else(|_| "no error body".into());
        return Err(format!("ElevenLabs returned {status}: {text}"));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read ElevenLabs response: {e}"))?;

    Ok(STANDARD.encode(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu-compositing",
        );
    }

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![generate_sound_effect])
        .run(tauri::generate_context!())
        .expect("error while running Hushwave");
}
