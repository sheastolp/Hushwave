use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

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

#[derive(Deserialize)]
struct FreesoundSearchResponse {
    results: Vec<FreesoundResult>,
}

#[derive(Deserialize)]
struct FreesoundResult {
    name: String,
    previews: FreesoundPreviews,
}

#[derive(Deserialize)]
struct FreesoundPreviews {
    #[serde(rename = "preview-hq-mp3")]
    preview_hq_mp3: String,
}

/// Searches Freesound's Creative-Commons-licensed sound library for a match to the prompt,
/// restricted to CC0-licensed results (public-domain equivalent, no attribution required),
/// and returns the top match's preview MP3 as base64. Free service, free API key — the caller
/// supplies their own key from freesound.org. Also runs from Rust to avoid depending on
/// Freesound's CORS policy holding steady, and to keep this symmetric with the ElevenLabs path.
#[tauri::command]
async fn search_freesound(
    query: String,
    api_key: String,
    min_duration: f64,
    max_duration: f64,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No Freesound API key configured.".into());
    }
    if query.trim().is_empty() {
        return Err("Search text is empty.".into());
    }

    let client = reqwest::Client::new();
    let filter = format!(
        "duration:[{min_duration} TO {max_duration}] AND license:\"Creative Commons 0\""
    );

    let search_response = client
        .get("https://freesound.org/apiv2/search/text/")
        .header("Authorization", format!("Token {}", api_key.trim()))
        .query(&[
            ("query", query.as_str()),
            ("filter", filter.as_str()),
            ("sort", "rating_desc"),
            ("fields", "name,previews"),
            ("page_size", "1"),
        ])
        .send()
        .await
        .map_err(|e| format!("Request to Freesound failed: {e}"))?;

    let status = search_response.status();
    if !status.is_success() {
        let text = search_response
            .text()
            .await
            .unwrap_or_else(|_| "no error body".into());
        return Err(format!("Freesound returned {status}: {text}"));
    }

    let parsed: FreesoundSearchResponse = search_response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Freesound response: {e}"))?;

    let first = parsed
        .results
        .into_iter()
        .next()
        .ok_or_else(|| "No CC0-licensed sounds matched that search on Freesound.".to_string())?;

    let audio_response = client
        .get(&first.previews.preview_hq_mp3)
        .send()
        .await
        .map_err(|e| format!("Failed to download '{}' from Freesound: {e}", first.name))?;

    let bytes = audio_response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read audio for '{}': {e}", first.name))?;

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
        .invoke_handler(tauri::generate_handler![
            generate_sound_effect,
            search_freesound
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hushwave");
}
