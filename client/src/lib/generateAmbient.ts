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

type Palette = "pad" | "rain" | "wind" | "fire" | "water";

function palette(prompt: string): Palette {
  const p = prompt.toLowerCase();
  if (/\b(rain|storm|shower|drizzle)\b/.test(p)) return "rain";
  if (/\b(ocean|wave|tide|sea|river|water|lake)\b/.test(p)) return "water";
  if (/\b(wind|breeze|sky|greenhouse)\b/.test(p)) return "wind";
  if (/\b(fire|cabin|ember|crackle|hearth|fireplace)\b/.test(p)) return "fire";
  return "pad";
}

const PENTATONIC = [0, 2, 4, 7, 9];

const SAMPLE_RATE = 22050;
const DURATION = 20;

export async function generateAmbientTrack(prompt: string): Promise<string> {
  const seed = hashString(prompt || "hushwave");
  const rng = mulberry32(seed);
  const kind = palette(prompt);

  const ctx = new OfflineAudioContext(1, SAMPLE_RATE * DURATION, SAMPLE_RATE);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  master.gain.setValueAtTime(0, 0);
  master.gain.linearRampToValueAtTime(0.5, 1.5);
  master.gain.setValueAtTime(0.5, DURATION - 1.5);
  master.gain.linearRampToValueAtTime(0, DURATION);

  if (kind === "pad") {
    const root = 55 * Math.pow(2, Math.floor(rng() * 3));
    const degrees = [0, PENTATONIC[1 + Math.floor(rng() * 2)], PENTATONIC[3 + Math.floor(rng() * 2)], PENTATONIC[Math.floor(rng() * PENTATONIC.length)] + 12];
    degrees.forEach((deg, i) => {
      const freq = root * Math.pow(2, deg / 12);
      const startAt = rng() * 2; // stagger entrances so the chord blooms in rather than snapping on
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq * (1 + (rng() - 0.5) * 0.01);

      // Slow per-oscillator vibrato, each at a slightly different rate so the notes drift
      // in and out of phase with each other instead of sitting there as one static drone.
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 0.08 + rng() * 0.15;
      const vibratoGain = ctx.createGain();
      vibratoGain.gain.value = 2 + rng() * 3;
      vibrato.connect(vibratoGain).connect(osc.detune);
      vibrato.start(0);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 700 + rng() * 500;

      // A slow filter sweep gives the pad movement over the loop instead of a flat tone.
      const filterLfo = ctx.createOscillator();
      filterLfo.frequency.value = 0.04 + rng() * 0.05;
      const filterLfoGain = ctx.createGain();
      filterLfoGain.gain.value = 180 + rng() * 120;
      filterLfo.connect(filterLfoGain).connect(filter.frequency);
      filterLfo.start(0);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(0.3 / degrees.length, startAt + 2.5);

      osc.connect(filter).connect(gain).connect(master);
      osc.start(startAt);
      osc.stop(DURATION);
    });

    // A faint filtered-noise bed under the tones keeps it from sounding like plain digital
    // sine waves — every real "pad" has some air/hiss under it.
    const airBuffer = ctx.createBuffer(1, SAMPLE_RATE * DURATION, SAMPLE_RATE);
    const airData = airBuffer.getChannelData(0);
    for (let i = 0; i < airData.length; i++) airData[i] = rng() * 2 - 1;
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = airBuffer;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 2000 + rng() * 1500;
    airFilter.Q.value = 0.5;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.035;
    airSrc.connect(airFilter).connect(airGain).connect(master);
    airSrc.start(0);
  } else {
    const buffer = ctx.createBuffer(1, SAMPLE_RATE * DURATION, SAMPLE_RATE);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    if (kind === "rain") {
      filter.type = "bandpass";
      filter.frequency.value = 3200;
      filter.Q.value = 0.6;
    } else if (kind === "wind") {
      filter.type = "bandpass";
      filter.frequency.value = 450 + rng() * 300;
      filter.Q.value = 0.5;
    } else if (kind === "fire") {
      filter.type = "lowpass";
      filter.frequency.value = 280;
    } else {
      filter.type = "bandpass";
      filter.frequency.value = 900 + rng() * 600;
      filter.Q.value = 0.45;
    }

    const amp = ctx.createGain();
    amp.gain.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06 + rng() * 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain).connect(amp.gain);
    lfo.start(0);

    src.connect(filter).connect(amp).connect(master);
    src.start(0);
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
