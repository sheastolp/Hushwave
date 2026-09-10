// Generates a short, original ambient loop entirely on-device using the Web Audio API,
// seeded from the prompt text so the same prompt always produces the same texture and
// different prompts produce genuinely different ones — no network call, no reused sample.

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Palette = "pad" | "rain" | "wind" | "fire" | "water" | "night" | "forest";

function palette(prompt: string): Palette {
  const p = prompt.toLowerCase();
  if (/\b(rain|storm|shower|drizzle)\w*/.test(p)) return "rain";
  if (/\b(ocean|wave|tide|sea|river|water|lake)\w*/.test(p)) return "water";
  if (/\b(wind|breeze|sky|greenhouse)\w*/.test(p)) return "wind";
  if (/\b(fire|cabin|ember|crackle|hearth|fireplace)\w*/.test(p)) return "fire";
  if (/\b(night|city|urban|traffic|street|town)\w*/.test(p)) return "night";
  if (/\b(forest|jungle|leaves|woods|meadow|birds?)\w*/.test(p)) return "forest";
  return "pad";
}

const PENTATONIC = [0, 2, 4, 7, 9];

const SAMPLE_RATE = 22050;
const DURATION = 20;

// A short, soft filtered-noise "blip" panned to a random spot in the stereo field — used
// sparingly for texture (a distant sound in "night", a leaf-rustle in "forest") rather than
// as the main body of the track.
function scheduleBlip(ctx: OfflineAudioContext, master: GainNode, rng: () => number, at: number, freq: number, q: number, gainPeak: number) {
  const dur = 0.15 + rng() * 0.25;
  const buffer = ctx.createBuffer(1, Math.ceil(SAMPLE_RATE * dur), SAMPLE_RATE);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(gainPeak, at + dur * 0.3);
  gain.gain.linearRampToValueAtTime(0, at + dur);
  const panner = ctx.createStereoPanner();
  panner.pan.value = (rng() - 0.5) * 1.6;
  src.connect(filter).connect(gain).connect(panner).connect(master);
  src.start(at);
}

export async function generateAmbientTrack(prompt: string): Promise<string> {
  const seed = hashString(prompt || "hushwave");
  const rng = mulberry32(seed);
  const kind = palette(prompt);

  // Stereo (2ch) rather than mono — genuinely independent left/right noise plus panned voices
  // instead of one centered mono signal, which is a large part of what made the first version
  // sound thin.
  const ctx = new OfflineAudioContext(2, SAMPLE_RATE * DURATION, SAMPLE_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.5, 1.5);
  master.gain.setValueAtTime(0.5, DURATION - 1.5);
  master.gain.linearRampToValueAtTime(0, DURATION);

  const addNoiseBed = (freqLow: number, freqHigh: number, gainPeak: number, lfoRate: number) => {
    // Two independently-seeded channels (not one mono signal panned) for real stereo width.
    const buffer = ctx.createBuffer(2, SAMPLE_RATE * DURATION, SAMPLE_RATE);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = (freqLow + freqHigh) / 2;
    filter.Q.value = 900 / (freqHigh - freqLow || 1);
    const amp = ctx.createGain();
    amp.gain.value = gainPeak;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = gainPeak * 0.4;
    lfo.connect(lfoGain).connect(amp.gain);
    lfo.start(0);
    src.connect(filter).connect(amp).connect(master);
    src.start(0);
    return filter;
  };

  if (kind === "pad") {
    const root = 55 * Math.pow(2, Math.floor(rng() * 3));
    const degrees = [0, PENTATONIC[1 + Math.floor(rng() * 2)], PENTATONIC[3 + Math.floor(rng() * 2)], PENTATONIC[Math.floor(rng() * PENTATONIC.length)] + 12, PENTATONIC[Math.floor(rng() * PENTATONIC.length)] + 19];
    degrees.forEach((deg, i) => {
      const freq = root * Math.pow(2, deg / 12);
      const startAt = rng() * 2;
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq * (1 + (rng() - 0.5) * 0.01);

      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 0.08 + rng() * 0.15;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = 2 + rng() * 3;
      vibrato.connect(vibratoGain).connect(osc.detune);
      vibrato.start(0);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700 + rng() * 500;

      const filterLfo = ctx.createOscillator();
      filterLfo.frequency.value = 0.04 + rng() * 0.05;
      const filterLfoGain = ctx.createGain();
      filterLfoGain.gain.value = 180 + rng() * 120;
      filterLfo.connect(filterLfoGain).connect(filter.frequency);
      filterLfo.start(0);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.28 / degrees.length, startAt + 2.5);

      // Spread the voices across the stereo field instead of stacking them all dead-center.
      const panner = ctx.createStereoPanner();
      panner.pan.value = (i / (degrees.length - 1) - 0.5) * 1.2 + (rng() - 0.5) * 0.15;

      osc.connect(filter).connect(gain).connect(panner).connect(master);
      osc.start(startAt);
      osc.stop(DURATION);
    });
    addNoiseBed(1600, 3400, 0.03, 0.05 + rng() * 0.05);
  } else if (kind === "rain") {
    addNoiseBed(2200, 5200, 0.42, 0.07 + rng() * 0.1);
    addNoiseBed(400, 1200, 0.1, 0.03); // a soft low wash under the droplet layer
    const dropCount = 40 + Math.floor(rng() * 25);
    for (let i = 0; i < dropCount; i++) {
      scheduleBlip(ctx, master, rng, rng() * (DURATION - 1), 3500 + rng() * 3000, 6, 0.12);
    }
  } else if (kind === "wind") {
    addNoiseBed(300, 900, 0.4, 0.05 + rng() * 0.08);
    addNoiseBed(900, 2000, 0.12, 0.09 + rng() * 0.06);
  } else if (kind === "fire") {
    addNoiseBed(80, 500, 0.4, 0.04);
    const crackleCount = 30 + Math.floor(rng() * 30);
    for (let i = 0; i < crackleCount; i++) {
      scheduleBlip(ctx, master, rng, rng() * (DURATION - 0.5), 2000 + rng() * 4000, 3, 0.14);
    }
  } else if (kind === "water") {
    addNoiseBed(600, 3200, 0.4, 0.05 + rng() * 0.06);
    addNoiseBed(150, 500, 0.15, 0.025);
  } else if (kind === "night") {
    addNoiseBed(60, 280, 0.32, 0.02); // distant low city hum
    const root = 55 * Math.pow(2, Math.floor(rng() * 2));
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = root;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0, 0);
    oscGain.gain.linearRampToValueAtTime(0.08, 3);
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = "lowpass";
    oscFilter.frequency.value = 300;
    osc.connect(oscFilter).connect(oscGain).connect(master);
    osc.start(0);
    osc.stop(DURATION);
    const blipCount = 6 + Math.floor(rng() * 8);
    for (let i = 0; i < blipCount; i++) {
      scheduleBlip(ctx, master, rng, 1 + rng() * (DURATION - 2), 500 + rng() * 900, 8, 0.05);
    }
  } else {
    // forest
    addNoiseBed(1200, 3800, 0.28, 0.08 + rng() * 0.08);
    addNoiseBed(300, 800, 0.12, 0.03);
    const chirpCount = 5 + Math.floor(rng() * 6);
    for (let i = 0; i < chirpCount; i++) {
      scheduleBlip(ctx, master, rng, 1 + rng() * (DURATION - 2), 2800 + rng() * 2200, 10, 0.045);
    }
  }

  const rendered = await ctx.startRendering();
  return audioBufferToWavUrl(rendered);
}

function audioBufferToWavUrl(buffer: AudioBuffer): string {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const blockAlign = numChannels * 2;
  const dataSize = samples * blockAlign;
  const arr = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arr);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) channelData.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }

  const blob = new Blob([arr], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

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

