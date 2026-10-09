// Online sound sources (ElevenLabs, Freesound). The on-device generator lives in ambientEngine.ts
// and is re-exported here so callers have one place to import sound generation from.
export { generateAmbientTrack, readPrompt } from "./ambientEngine";
export type { GeneratedTrack, GenerateOptions, PromptReading } from "./ambientEngine";

export class SoundApiError extends Error {}

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Calls the user's own ElevenLabs account (Sound Effects API) via the Rust backend — never
 * directly from the browser, since that endpoint isn't set up for direct WebView/CORS calls
 * and this keeps the key out of the JS network layer entirely. Throws SoundApiError with a
 * human-readable message on any failure; callers should fall back to generateAmbientTrack().
 */
export async function generateAmbientTrackViaApi(prompt: string, apiKey: string, durationSeconds = 20): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const base64 = await invoke<string>("generate_sound_effect", {
      text: prompt,
      apiKey,
      durationSeconds,
    });
    return base64ToBlobUrl(base64, "audio/mpeg");
  } catch (err) {
    throw new SoundApiError(typeof err === "string" ? err : "The ElevenLabs request failed.");
  }
}

/**
 * Free alternative to the ElevenLabs path: searches the user's own Freesound.org account for a
 * real Creative-Commons (CC0-only) recording matching the prompt, rather than generating audio
 * from scratch. Free account, free API key, no payment. Same Rust-backend pattern as above —
 * avoids depending on Freesound's CORS policy and keeps the key off the JS network layer.
 */
export async function generateAmbientTrackViaFreesound(prompt: string, apiKey: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const base64 = await invoke<string>("search_freesound", {
      query: prompt,
      apiKey,
      minDuration: 5,
      maxDuration: 45,
    });
    return base64ToBlobUrl(base64, "audio/mpeg");
  } catch (err) {
    throw new SoundApiError(typeof err === "string" ? err : "The Freesound request failed.");
  }
}

