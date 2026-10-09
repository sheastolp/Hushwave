// Hushwave's on-device ambient engine. Reads a free-text prompt, picks every sound layer it
// mentions (rain + thunder + fireplace, birds + stream, …) plus modifiers for intensity, tone,
// and room size, then renders a seamless stereo loop with the Web Audio API. Nothing is
// downloaded and no samples are reused: every layer is synthesized from noise and oscillators,
// seeded from the prompt so the same prompt (and variation number) always gives the same result.

const SAMPLE_RATE = 32000;
// Extra audio rendered past the loop length and crossfaded back onto the start, so the loop
// point is gapless instead of fading to silence and back every time it repeats.
const LOOP_XFADE = 4;
const MAX_LAYERS = 5;

type Rng = () => number;

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): Rng {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Prompt reading ──────────────────────────────────────────────────────────────────────────

type LayerId =
  | "rain" | "thunder" | "wind" | "fire" | "waves" | "stream" | "crickets" | "birds"
  | "city" | "cafe" | "train" | "hum" | "drone" | "bells" | "pad" | "white" | "pink" | "brown";

const LAYERS: { id: LayerId; label: string; re: RegExp }[] = [
  { id: "white", label: "white noise", re: /\bwhite noise\b/ },
  { id: "pink", label: "pink noise", re: /\bpink noise\b/ },
  { id: "brown", label: "brown noise", re: /\b(brown|red) noise\b/ },
  { id: "rain", label: "rain", re: /\b(rain\w*|drizzl\w*|showers?|downpour|storm\w*|monsoon|drops?)\b/ },
  { id: "thunder", label: "distant thunder", re: /\b(thunder\w*|storm\w*|lightning)\b/ },
  { id: "wind", label: "wind", re: /\b(wind|winds|windy|breez\w*|gust\w*|blizzard|mountain\w*|desert|tundra|sky|greenhouse|snow\w*)\b/ },
  { id: "fire", label: "fireplace", re: /\b(fire|fires|fireplace|fireside|campfire|bonfire|ember\w*|crackl\w*|hearth|candles?)\b/ },
  { id: "waves", label: "ocean waves", re: /\b(ocean|waves?|tides?|sea|shores?|shoreline|beach|surf|coast\w*|harbou?r)\b/ },
  { id: "stream", label: "stream", re: /\b(streams?|creek|brook|river\w*|waterfall|fountain|babbl\w*|trickl\w*)\b/ },
  { id: "crickets", label: "crickets", re: /\b(crickets?|(?<!late[- ])night\w*|insects?|cicadas?|moonlit|midnight|summer evening|swamp|bayou)\b/ },
  { id: "birds", label: "birdsong", re: /\b(birds?|birdsong|chirp\w*|dawn|sunrise|songbirds?|spring|meadow|forest|woods|woodland|jungle|garden|park)\b/ },
  { id: "city", label: "city traffic", re: /\b(city|urban|traffic|streets?|cars?|downtown|highway|road)\b/ },
  { id: "cafe", label: "café murmur", re: /café|\b(cafes?|coffee|restaurant|bar|pub|crowd\w*|people|chatter|diner|market)\b/ },
  { id: "train", label: "train rhythm", re: /\b(trains?|railway|rail|subway|metro|carriage)\b/ },
  { id: "hum", label: "low hum", re: /\b(fan|hvac|air ?con\w*|airplane|plane|flight|engine|server|ship|hum\w*|room tone|fridge|office|library)\b/ },
  { id: "drone", label: "deep drone", re: /\b(drone|space|cosmic|galaxy|nebula|void|abyss|underwater|cave|cavern|alien|orbit)\b/ },
  { id: "bells", label: "soft chimes", re: /\b(bells?|chimes?|piano|music ?box|kalimba|temple|singing bowls?|glass\w*)\b/ },
  { id: "pad", label: "warm pad", re: /\b(pad|synth\w*|chords?|music\w*|melod\w*|dream\w*|ambient|meditat\w*|calm\w*|relax\w*|sleep\w*|lo-?fi|ethereal|heaven\w*|focus|study)\b/ },
];

const SOFT = /\b(soft\w*|gentle|gently|light|quiet\w*|calm|distant|faint|whisper\w*|drizzl\w*|lull\w*|slow|tiny|sleepy)\b/;
const HEAVY = /\b(heavy|loud|intense|pouring|downpour|roaring|strong|wild|raging|busy|torrential|crashing|howling)\b/;
const DARK = /\b(dark\w*|deep|warm|low|muffled|moonlit|night\w*|cozy|cosy|midnight|underwater|velvet|brooding|rainy)\b/;
const BRIGHT = /\b(bright|airy|crisp|morning|sunny|sparkl\w*|shimmer\w*|clear|dawn|spring|summer|light)\b/;
const BIG = /\b(cathedral|hall|cave|cavern|canyon|vast|space|cosmic|huge|church|tunnel|temple|valley|stadium|big|large|open)\b/;
const SMALL = /\b(room|cabin|car|closet|small|tent|indoor\w*|bedroom|booth|cozy|cosy|attic)\b/;
const MUFFLED = /\b(muffled|underwater|through (a|the) (window|wall)s?|inside|indoors|from bed|under (a|the) blanket)\b/;

export type PromptReading = {
  layers: LayerId[];
  labels: string[];
  intensity: number;
  tone: number;
  space: { wet: number; decay: number; label: string };
  muffle: number | null;
  modifiers: string[];
};

/** Works out which layers and modifiers a prompt will produce — used for the live preview in the UI. */
export function readPrompt(prompt: string): PromptReading {
  const p = prompt.toLowerCase();
  const found = LAYERS.map((l) => ({ l, at: p.search(l.re) })).filter((x) => x.at >= 0);
  found.sort((a, b) => a.at - b.at);
  let layers = found.slice(0, MAX_LAYERS).map((x) => x.l.id);
  // "storm" matches rain and thunder both; make sure thunder never shows up without its rain.
  if (layers.includes("thunder") && !layers.includes("rain") && layers.length < MAX_LAYERS) layers.unshift("rain");
  if (layers.length === 0) layers = ["pad"];

  const intensity = HEAVY.test(p) ? 1.35 : SOFT.test(p) ? 0.65 : 1;
  const tone = DARK.test(p) && !BRIGHT.test(p) ? 0.7 : BRIGHT.test(p) && !DARK.test(p) ? 1.3 : 1;
  const space = BIG.test(p)
    ? { wet: 0.5, decay: 5.5, label: "large space" }
    : SMALL.test(p)
    ? { wet: 0.16, decay: 1.2, label: "small room" }
    : { wet: 0.28, decay: 2.6, label: "" };
  const muffle = /underwater/.test(p) ? 650 : MUFFLED.test(p) ? 1800 : null;

  const modifiers = [
    intensity > 1 ? "intense" : intensity < 1 ? "gentle" : "",
    tone < 1 ? "dark" : tone > 1 ? "bright" : "",
    space.label,
    muffle ? "muffled" : "",
  ].filter(Boolean);

  return { layers, labels: layers.map((id) => LAYERS.find((l) => l.id === id)!.label), intensity, tone, space, muffle, modifiers };
}

// ── Rendering helpers ───────────────────────────────────────────────────────────────────────

type NoiseColor = "white" | "pink" | "brown";

type Env = {
  ctx: OfflineAudioContext;
  rng: Rng;
  sr: number;
  len: number; // samples, including the crossfade tail
  dur: number; // seconds, including the crossfade tail
  intensity: number;
  tone: number;
  bus: AudioNode;
  noise: Partial<Record<NoiseColor, AudioBuffer>>;
  scale: number[];
  root: number;
};

const NOISE_SECONDS = 9;

function noiseBuffer(e: Env, color: NoiseColor): AudioBuffer {
  const cached = e.noise[color];
  if (cached) return cached;
  const buf = e.ctx.createBuffer(2, e.sr * NOISE_SECONDS, e.sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brown = 0;
    for (let i = 0; i < d.length; i++) {
      const w = e.rng() * 2 - 1;
      if (color === "white") {
        d[i] = w;
      } else if (color === "pink") {
        // Paul Kellet's refined pink-noise filter.
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        brown = (brown + 0.02 * w) / 1.02;
        d[i] = brown * 3.5;
      }
    }
  }
  e.noise[color] = buf;
  return buf;
}

// A looping noise source started at a random offset, so several layers sharing one buffer
// aren't correlated with each other.
function noise(e: Env, color: NoiseColor): AudioBufferSourceNode {
  const src = e.ctx.createBufferSource();
  src.buffer = noiseBuffer(e, color);
  src.loop = true;
  src.start(0, e.rng() * NOISE_SECONDS);
  return src;
}

function filter(e: Env, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = e.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(freq, e.sr / 2 - 100);
  f.Q.value = q;
  return f;
}

function gain(e: Env, value: number): GainNode {
  const g = e.ctx.createGain();
  g.gain.value = value;
  return g;
}

function pan(e: Env, value: number): StereoPannerNode {
  const p = e.ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, value));
  return p;
}

// A smooth, non-periodic wander between random values — sounds far more natural than a sine LFO.
function wander(rng: Rng, points: number, min: number, max: number, resolution = 1024): Float32Array {
  const pts = Array.from({ length: Math.max(2, Math.round(points)) }, () => min + rng() * (max - min));
  const out = new Float32Array(resolution);
  for (let i = 0; i < resolution; i++) {
    const x = (i / (resolution - 1)) * (pts.length - 1);
    const j = Math.floor(x);
    const a = pts[j];
    const b = pts[Math.min(j + 1, pts.length - 1)];
    const s = (1 - Math.cos((x - j) * Math.PI)) / 2;
    out[i] = a + (b - a) * s;
  }
  return out;
}

function automate(e: Env, param: AudioParam, curve: Float32Array) {
  param.setValueCurveAtTime(curve, 0, e.dur);
}

// A stereo buffer that a layer writes individual events into (raindrops, chirps, crackles…).
// Far cheaper than creating thousands of audio nodes, and it gives sample-level control.
class Events {
  readonly L: Float32Array;
  readonly R: Float32Array;
  private readonly buf: AudioBuffer;
  constructor(private readonly e: Env) {
    this.buf = e.ctx.createBuffer(2, e.len, e.sr);
    this.L = this.buf.getChannelData(0);
    this.R = this.buf.getChannelData(1);
  }
  /** Writes `n` samples of `fn(i)` starting at `start` seconds, placed at stereo position `p` (-1…1). */
  add(start: number, n: number, p: number, fn: (i: number) => number) {
    const s0 = Math.floor(start * this.e.sr);
    const angle = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4;
    const lg = Math.cos(angle);
    const rg = Math.sin(angle);
    const end = Math.min(n, this.e.len - s0);
    for (let i = Math.max(0, -s0); i < end; i++) {
      const v = fn(i);
      this.L[s0 + i] += v * lg;
      this.R[s0 + i] += v * rg;
    }
  }
  source(): AudioBufferSourceNode {
    const src = this.e.ctx.createBufferSource();
    src.buffer = this.buf;
    src.start(0);
    return src;
  }
}

function onePole(fc: number, sr: number) {
  return 1 - Math.exp((-2 * Math.PI * fc) / sr);
}

// ── Layers ──────────────────────────────────────────────────────────────────────────────────

function layerRain(e: Env) {
  const k = e.intensity;
  const g = gain(e, 0);
  automate(e, g.gain, wander(e.rng, e.dur / 6, 0.32 * k, 0.45 * k));
  noise(e, "pink").connect(filter(e, "highpass", 450 * e.tone)).connect(filter(e, "lowpass", 6500 * e.tone)).connect(g).connect(e.bus);
  noise(e, "white").connect(filter(e, "highpass", 4500)).connect(gain(e, 0.025 * k)).connect(e.bus);

  const ev = new Events(e);
  const drops = Math.round(e.dur * 75 * k);
  for (let d = 0; d < drops; d++) {
    const f = (2200 + e.rng() * 4800) * e.tone;
    const n = Math.floor(e.sr * (0.003 + e.rng() * 0.008));
    const amp = (0.04 + e.rng() * 0.1) * (e.rng() < 0.08 ? 2.2 : 1);
    const w = (2 * Math.PI * f) / e.sr;
    const tau = n / 4;
    ev.add(e.rng() * e.dur, n, e.rng() * 2 - 1, (i) => Math.sin(w * i) * Math.exp(-i / tau) * amp);
  }
  ev.source().connect(gain(e, 0.55 * k)).connect(e.bus);
}

function layerThunder(e: Env) {
  const ev = new Events(e);
  const count = Math.max(1, Math.round((e.dur / 28) * e.intensity));
  for (let t = 0; t < count; t++) {
    const at = ((t + 0.15 + e.rng() * 0.7) / count) * (e.dur - LOOP_XFADE);
    const attack = 0.25 + e.rng() * 0.8;
    const tau = 1.4 + e.rng() * 2;
    const n = Math.floor(e.sr * (attack + tau * 4));
    const a = onePole(140 + e.rng() * 220, e.sr);
    const amp = (0.5 + e.rng() * 0.45) * e.intensity;
    const near = e.rng() < 0.3;
    let brown = 0;
    let y = 0;
    let y2 = 0;
    // A rumble isn't one smooth swell — add a few slower pulses inside it.
    const pulse = 0.6 + e.rng() * 1.2;
    ev.add(at, n, (e.rng() - 0.5) * 0.8, (i) => {
      const t = i / e.sr;
      brown = (brown + 0.02 * (e.rng() * 2 - 1)) / 1.02;
      y += a * (brown * 3.5 - y);
      y2 += a * (y - y2);
      const env = (t < attack ? t / attack : Math.exp(-(t - attack) / tau)) * (0.75 + 0.25 * Math.sin(2 * Math.PI * pulse * t));
      const crack = near && t < 0.4 ? (e.rng() * 2 - 1) * Math.exp(-t / 0.08) * 0.12 : 0;
      return y2 * env * amp * 4 + crack;
    });
  }
  ev.source().connect(filter(e, "lowpass", 2500)).connect(e.bus);
}

function layerWind(e: Env) {
  const k = e.intensity;
  for (let v = 0; v < 2; v++) {
    const bp = filter(e, "bandpass", 500, 0.9);
    automate(e, bp.frequency, wander(e.rng, e.dur / 4, 250 * e.tone, 1000 * e.tone));
    const g = gain(e, 0);
    automate(e, g.gain, wander(e.rng, e.dur / 3, 0.04, 0.4 * k));
    noise(e, "pink").connect(bp).connect(g).connect(pan(e, v ? 0.55 : -0.55)).connect(e.bus);
  }
  const whistle = filter(e, "bandpass", 900, 14);
  automate(e, whistle.frequency, wander(e.rng, e.dur / 5, 550 * e.tone, 1500 * e.tone));
  const wg = gain(e, 0);
  automate(e, wg.gain, wander(e.rng, e.dur / 4, 0, 0.12 * k));
  noise(e, "white").connect(whistle).connect(wg).connect(e.bus);
}

function layerFire(e: Env) {
  const k = e.intensity;
  const roar = gain(e, 0);
  automate(e, roar.gain, wander(e.rng, e.dur / 2, 0.2 * k, 0.38 * k));
  noise(e, "brown").connect(filter(e, "lowpass", 380 * e.tone)).connect(roar).connect(e.bus);

  const ev = new Events(e);
  const clusters = Math.round(e.dur * 9 * k);
  for (let c = 0; c < clusters; c++) {
    let at = e.rng() * e.dur;
    const p = (e.rng() - 0.5) * 1.2;
    const clicks = 1 + Math.floor(e.rng() * 4);
    for (let j = 0; j < clicks; j++) {
      const pop = e.rng() < 0.05;
      const tau = e.sr * (pop ? 0.006 : 0.0004 + e.rng() * 0.0012);
      const amp = pop ? 0.6 : 0.15 + e.rng() * 0.45;
      ev.add(at, Math.ceil(tau * 6), p, (i) => (e.rng() * 2 - 1) * Math.exp(-i / tau) * amp);
      at += 0.004 + e.rng() * 0.04;
    }
  }
  ev.source().connect(filter(e, "highpass", 900)).connect(filter(e, "lowpass", 7000 * e.tone)).connect(gain(e, 0.5 * k)).connect(e.bus);
}

// One sea "breath": slow swell, a crest, then a long receding hiss.
function waveCurves(e: Env, offset: number) {
  const rate = 40;
  const n = Math.ceil(e.dur * rate);
  const level = new Float32Array(n);
  const bright = new Float32Array(n);
  let t = -offset;
  while (t < e.dur) {
    const period = 6.5 + e.rng() * 5;
    const size = 0.6 + e.rng() * 0.4;
    for (let i = Math.max(0, Math.floor(t * rate)); i < Math.min(n, Math.floor((t + period) * rate)); i++) {
      const ph = (i / rate - t) / period;
      const env = ph < 0.42 ? Math.pow(ph / 0.42, 2) : Math.exp(-(ph - 0.42) * 4.5);
      level[i] = Math.max(level[i], env * size);
      bright[i] = Math.max(bright[i], env * size);
    }
    t += period * (0.85 + e.rng() * 0.25);
  }
  return {
    level: level.map((v) => 0.06 + v * 0.55 * e.intensity),
    bright: bright.map((v) => (280 + v * 2600) * e.tone),
  };
}

function layerWaves(e: Env) {
  for (let v = 0; v < 2; v++) {
    const { level, bright } = waveCurves(e, e.rng() * 5);
    const lp = filter(e, "lowpass", 800, 0.5);
    automate(e, lp.frequency, bright);
    const g = gain(e, 0);
    automate(e, g.gain, level);
    noise(e, "pink").connect(lp).connect(g).connect(pan(e, v ? 0.45 : -0.45)).connect(e.bus);
  }
  noise(e, "brown").connect(filter(e, "lowpass", 220)).connect(gain(e, 0.12)).connect(e.bus);
}

function layerStream(e: Env) {
  const k = e.intensity;
  noise(e, "white").connect(filter(e, "bandpass", 1600 * e.tone, 0.7)).connect(gain(e, 0.06 * k)).connect(e.bus);
  const g = gain(e, 0);
  automate(e, g.gain, wander(e.rng, e.dur / 2, 0.08, 0.16 * k));
  noise(e, "pink").connect(filter(e, "bandpass", 650 * e.tone, 1)).connect(g).connect(e.bus);

  const ev = new Events(e);
  const bubbles = Math.round(e.dur * 38 * k);
  for (let b = 0; b < bubbles; b++) {
    const f0 = (380 + e.rng() * 1500) * e.tone;
    const n = Math.floor(e.sr * (0.008 + e.rng() * 0.025));
    const amp = 0.025 + e.rng() * 0.07;
    let phase = 0;
    ev.add(e.rng() * e.dur, n, (e.rng() - 0.5) * 1.4, (i) => {
      // A bubble's pitch rises as it shrinks — that rising blip is what makes water sound wet.
      phase += (2 * Math.PI * f0 * (1 + (1.8 * i) / n)) / e.sr;
      return Math.sin(phase) * Math.sin((Math.PI * i) / n) * amp;
    });
  }
  ev.source().connect(gain(e, 0.8)).connect(e.bus);
}

function layerCrickets(e: Env) {
  noise(e, "brown").connect(filter(e, "lowpass", 260)).connect(gain(e, 0.07)).connect(e.bus);
  const ev = new Events(e);
  const crickets = 2 + Math.floor(e.rng() * 3);
  for (let c = 0; c < crickets; c++) {
    const f = 3800 + e.rng() * 1400;
    const w = (2 * Math.PI * f) / e.sr;
    const pulses = 3 + Math.floor(e.rng() * 3);
    const pulseLen = 0.01 + e.rng() * 0.006;
    const gap = 0.007 + e.rng() * 0.005;
    const every = 0.45 + e.rng() * 0.5;
    const amp = (0.015 + e.rng() * 0.04) * e.intensity;
    const p = e.rng() * 2 - 1;
    const n = Math.floor(pulseLen * e.sr);
    // Crickets go quiet now and then — gives the texture some breathing room.
    for (let t = e.rng() * every; t < e.dur; t += every * (0.92 + e.rng() * 0.16)) {
      if (e.rng() < 0.12) t += 1 + e.rng() * 3;
      for (let j = 0; j < pulses; j++) {
        ev.add(t + j * (pulseLen + gap), n, p, (i) => Math.sin(w * i) * Math.pow(Math.sin((Math.PI * i) / n), 2) * amp);
      }
    }
  }
  ev.source().connect(e.bus);
}

function layerBirds(e: Env) {
  const ev = new Events(e);
  const species = 2 + Math.floor(e.rng() * 2);
  for (let s = 0; s < species; s++) {
    const base = 2200 + e.rng() * 2600;
    const sweep = (e.rng() * 2 - 1) * 1600;
    const sylLen = 0.05 + e.rng() * 0.09;
    const vibRate = 15 + e.rng() * 45;
    const vibDepth = 40 + e.rng() * 300;
    const amp = (0.03 + e.rng() * 0.04) * Math.min(1.2, e.intensity);
    const p = e.rng() * 1.6 - 0.8;
    const meanGap = (2.2 + e.rng() * 3) / e.intensity;
    for (let t = e.rng() * meanGap; t < e.dur; t += meanGap * (0.5 + e.rng())) {
      const syllables = 2 + Math.floor(e.rng() * 6);
      let at = t;
      for (let j = 0; j < syllables; j++) {
        const n = Math.floor(e.sr * sylLen * (0.7 + e.rng() * 0.6));
        const f0 = base * (0.9 + e.rng() * 0.2);
        let phase = 0;
        ev.add(at, n, p, (i) => {
          const x = i / n;
          phase += (2 * Math.PI * (f0 + sweep * x + vibDepth * Math.sin((2 * Math.PI * vibRate * i) / e.sr))) / e.sr;
          const env = Math.pow(Math.sin(Math.PI * x), 2);
          return (Math.sin(phase) + 0.18 * Math.sin(2 * phase)) * env * amp;
        });
        at += n / e.sr + 0.03 + e.rng() * 0.07;
      }
    }
  }
  ev.source().connect(e.bus);
}

function layerCity(e: Env) {
  const k = e.intensity;
  const bed = gain(e, 0);
  automate(e, bed.gain, wander(e.rng, e.dur / 5, 0.18 * k, 0.3 * k));
  noise(e, "brown").connect(filter(e, "lowpass", 420 * e.tone)).connect(bed).connect(e.bus);
  const cars = Math.max(1, Math.round((e.dur / 5) * k));
  for (let c = 0; c < cars; c++) {
    const at = e.rng() * e.dur;
    const len = 3.5 + e.rng() * 4.5;
    const peak = 0.12 + e.rng() * 0.22;
    const bell = new Float32Array(128).map((_, i) => Math.pow(Math.sin((Math.PI * i) / 127), 2) * peak);
    const g = gain(e, 0);
    g.gain.setValueCurveAtTime(bell, at, len);
    const pn = e.ctx.createStereoPanner();
    const dir = e.rng() < 0.5 ? 1 : -1;
    pn.pan.setValueAtTime(-0.9 * dir, at);
    pn.pan.linearRampToValueAtTime(0.9 * dir, at + len);
    noise(e, "pink").connect(filter(e, "bandpass", 380 + e.rng() * 400, 0.6)).connect(g).connect(pn).connect(e.bus);
  }
}

function layerCafe(e: Env) {
  const k = e.intensity;
  const voices = filter(e, "lowpass", 2400 * e.tone);
  voices.connect(e.bus);
  for (let v = 0; v < 6; v++) {
    const bp = filter(e, "bandpass", 400 + e.rng() * 600, 2.2);
    automate(e, bp.frequency, wander(e.rng, e.dur * 2, 350, 1100));
    const g = gain(e, 0);
    // Fast, syllable-rate wobble so the band of noise reads as distant talking.
    automate(e, g.gain, wander(e.rng, e.dur * 4, 0, 0.16 * k, 4096));
    noise(e, "pink").connect(bp).connect(g).connect(pan(e, e.rng() * 1.6 - 0.8)).connect(voices);
  }
  noise(e, "brown").connect(filter(e, "lowpass", 300)).connect(gain(e, 0.08)).connect(e.bus);

  const ev = new Events(e);
  const clinks = Math.round(e.dur * 0.3 * k);
  for (let c = 0; c < clinks; c++) {
    const f0 = 2600 + e.rng() * 2400;
    const tau = e.sr * (0.06 + e.rng() * 0.2);
    const amp = 0.02 + e.rng() * 0.04;
    const ws = [1, 2.32, 4.07].map((r) => (2 * Math.PI * f0 * r) / e.sr);
    ev.add(e.rng() * e.dur, Math.ceil(tau * 5), e.rng() * 1.6 - 0.8, (i) => (Math.sin(ws[0] * i) + 0.5 * Math.sin(ws[1] * i) + 0.25 * Math.sin(ws[2] * i) * Math.exp(-i / tau)) * Math.exp(-i / tau) * amp);
  }
  ev.source().connect(e.bus);
}

function layerTrain(e: Env) {
  const k = e.intensity;
  const rumble = gain(e, 0);
  automate(e, rumble.gain, wander(e.rng, e.dur / 4, 0.25 * k, 0.4 * k));
  noise(e, "brown").connect(filter(e, "lowpass", 170)).connect(rumble).connect(e.bus);
  noise(e, "pink").connect(filter(e, "bandpass", 320, 0.8)).connect(gain(e, 0.08 * k)).connect(e.bus);

  const ev = new Events(e);
  const period = 1.0 + e.rng() * 0.35;
  const a = onePole(650, e.sr);
  for (let t = e.rng() * period; t < e.dur; t += period * (0.99 + e.rng() * 0.02)) {
    for (const off of [0, 0.13]) {
      let y = 0;
      const tau = e.sr * 0.018;
      const amp = (0.35 + e.rng() * 0.15) * k;
      ev.add(t + off, Math.ceil(tau * 6), (e.rng() - 0.5) * 0.3, (i) => {
        y += a * (e.rng() * 2 - 1 - y);
        return y * Math.exp(-i / tau) * amp * 3;
      });
    }
  }
  ev.source().connect(e.bus);
}

function layerHum(e: Env) {
  noise(e, "brown").connect(filter(e, "lowpass", 260 * e.tone)).connect(gain(e, 0.3 * e.intensity)).connect(e.bus);
  noise(e, "pink").connect(filter(e, "bandpass", 900 * e.tone, 0.5)).connect(gain(e, 0.05)).connect(e.bus);
  const mains = e.rng() < 0.5 ? 50 : 60;
  for (const [mult, level] of [[1, 0.018], [2, 0.01]] as const) {
    const o = e.ctx.createOscillator();
    o.frequency.value = mains * mult;
    o.connect(gain(e, level)).connect(e.bus);
    o.start(0);
  }
}

function layerDrone(e: Env) {
  const root = (36 + e.rng() * 24) * (e.tone < 1 ? 0.85 : 1);
  [1, 1.5, 2.003].forEach((ratio, i) => {
    const o = e.ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = root * ratio;
    o.detune.value = (e.rng() - 0.5) * 12;
    const lp = filter(e, "lowpass", 300, 2.5);
    automate(e, lp.frequency, wander(e.rng, e.dur / 7, 120 * e.tone, 650 * e.tone));
    o.connect(lp).connect(gain(e, 0.07)).connect(pan(e, (i - 1) * 0.5)).connect(e.bus);
    o.start(0);
  });
  const shimmer = e.ctx.createOscillator();
  shimmer.frequency.value = root * 8;
  const sg = gain(e, 0);
  automate(e, sg.gain, wander(e.rng, e.dur / 3, 0, 0.012));
  shimmer.connect(sg).connect(e.bus);
  shimmer.start(0);
}

function layerPad(e: Env, alone: boolean) {
  const chords = 2 + Math.floor(e.rng() * 3);
  const loopLen = e.dur - LOOP_XFADE;
  const span = loopLen / chords;
  const fade = Math.min(4, span / 2);
  for (let c = 0; c < chords; c++) {
    const start = c * span;
    const end = c === chords - 1 ? e.dur : start + span + fade;
    const rootDeg = Math.floor(e.rng() * e.scale.length);
    const degrees = [0, 2, 4, 7].map((step) => rootDeg + step).slice(0, 3 + Math.floor(e.rng() * 2));
    degrees.forEach((deg, v) => {
      const semis = e.scale[deg % e.scale.length] + 12 * Math.floor(deg / e.scale.length);
      const freq = e.root * Math.pow(2, semis / 12);
      const lp = filter(e, "lowpass", 900 * e.tone, 0.5);
      automate(e, lp.frequency, wander(e.rng, e.dur / 8, 600 * e.tone, 1500 * e.tone));
      const g = e.ctx.createGain();
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.09 / degrees.length, start + fade);
      g.gain.setValueAtTime(0.09 / degrees.length, Math.max(start + fade, end - fade));
      g.gain.linearRampToValueAtTime(0, end);
      lp.connect(g).connect(pan(e, (v / Math.max(1, degrees.length - 1) - 0.5) * 1.1)).connect(e.bus);
      // Two slightly detuned oscillators per note give the gentle chorus of a real synth pad.
      for (const cents of [-7, 7]) {
        const o = e.ctx.createOscillator();
        o.type = v % 2 ? "triangle" : "sine";
        o.frequency.value = freq;
        o.detune.value = cents + (e.rng() - 0.5) * 4;
        o.connect(lp);
        o.start(start);
        o.stop(end + 0.05);
      }
    });
  }
  if (alone) noise(e, "pink").connect(filter(e, "bandpass", 2400 * e.tone, 0.6)).connect(gain(e, 0.03)).connect(e.bus);
}

function layerBells(e: Env) {
  const ev = new Events(e);
  const notes = Math.max(3, Math.round((e.dur / 3.2) * e.intensity));
  const partials: [number, number, number][] = [[1, 1, 1], [2, 0.35, 0.7], [2.76, 0.22, 0.5], [5.4, 0.08, 0.25]];
  for (let n = 0; n < notes; n++) {
    const deg = Math.floor(e.rng() * e.scale.length);
    const freq = e.root * 4 * Math.pow(2, (e.scale[deg] + 12 * Math.floor(e.rng() * 2)) / 12);
    const tau = 1.2 + e.rng() * 1.8;
    const len = Math.floor(e.sr * Math.min(7, tau * 4.5));
    const amp = 0.035 + e.rng() * 0.03;
    const ws = partials.map(([r]) => (2 * Math.PI * freq * r) / e.sr);
    ev.add(e.rng() * (e.dur - 1), len, e.rng() * 1.4 - 0.7, (i) => {
      const t = i / e.sr;
      let v = 0;
      for (let p = 0; p < partials.length; p++) v += Math.sin(ws[p] * i) * partials[p][1] * Math.exp(-t / (tau * partials[p][2]));
      return v * amp * Math.min(1, i / 40);
    });
  }
  ev.source().connect(e.bus);
}

function layerNoise(e: Env, color: NoiseColor) {
  const level = color === "white" ? 0.12 : color === "pink" ? 0.3 : 0.45;
  noise(e, color).connect(gain(e, level * e.intensity)).connect(e.bus);
}

// Synthetic impulse response for the room/space reverb: decaying stereo noise that also gets
// darker as it decays, the way real rooms absorb high frequencies first.
function impulseResponse(e: Env, seconds: number): AudioBuffer {
  const n = Math.floor(e.sr * seconds);
  const pre = Math.floor(e.sr * 0.02);
  const ir = e.ctx.createBuffer(2, n + pre, e.sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const x = i / n;
      y += (0.9 - 0.8 * x) * (e.rng() * 2 - 1 - y);
      d[pre + i] = y * Math.pow(1 - x, 2.2);
    }
  }
  return ir;
}

// ── Main entry point ───────────────────────────────────────────────────────────────────────

export type GenerateOptions = { durationSeconds?: number; variation?: number };
export type GeneratedTrack = { url: string; labels: string[]; modifiers: string[]; durationSeconds: number };

const MAJOR_PENTA = [0, 2, 4, 7, 9];
const MINOR_PENTA = [0, 3, 5, 7, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];

export async function generateAmbientTrack(prompt: string, options: GenerateOptions = {}): Promise<GeneratedTrack> {
  const loopSeconds = Math.max(10, Math.min(300, options.durationSeconds ?? 30));
  const variation = options.variation ?? 0;
  const rng = mulberry32(hashString(`${prompt.trim().toLowerCase() || "hushwave"}#${variation}`));
  const reading = readPrompt(prompt);

  const total = loopSeconds + LOOP_XFADE;
  const len = Math.ceil(total * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, len, SAMPLE_RATE);

  // Mix bus → dry + reverb → optional muffle → output.
  const bus = ctx.createGain();
  const out = ctx.createGain();
  let tail: AudioNode = out;
  if (reading.muffle) {
    const m = ctx.createBiquadFilter();
    m.type = "lowpass";
    m.frequency.value = reading.muffle;
    out.connect(m);
    tail = m;
  }
  tail.connect(ctx.destination);
  bus.connect(out);

  const e: Env = {
    ctx,
    rng,
    sr: SAMPLE_RATE,
    len,
    dur: total,
    intensity: reading.intensity,
    tone: reading.tone,
    bus,
    noise: {},
    scale: reading.tone < 1 ? (rng() < 0.6 ? MINOR_PENTA : DORIAN) : reading.tone > 1 ? (rng() < 0.6 ? MAJOR_PENTA : LYDIAN) : rng() < 0.5 ? MAJOR_PENTA : MINOR_PENTA,
    root: 110 * Math.pow(2, Math.floor(rng() * 7) / 12),
  };

  const verb = ctx.createConvolver();
  verb.buffer = impulseResponse(e, reading.space.decay);
  bus.connect(verb).connect(gain(e, reading.space.wet)).connect(out);

  for (const id of reading.layers) {
    switch (id) {
      case "rain": layerRain(e); break;
      case "thunder": layerThunder(e); break;
      case "wind": layerWind(e); break;
      case "fire": layerFire(e); break;
      case "waves": layerWaves(e); break;
      case "stream": layerStream(e); break;
      case "crickets": layerCrickets(e); break;
      case "birds": layerBirds(e); break;
      case "city": layerCity(e); break;
      case "cafe": layerCafe(e); break;
      case "train": layerTrain(e); break;
      case "hum": layerHum(e); break;
      case "drone": layerDrone(e); break;
      case "bells": layerBells(e); break;
      case "pad": layerPad(e, reading.layers.length === 1); break;
      case "white": case "pink": case "brown": layerNoise(e, id); break;
    }
  }

  const rendered = await ctx.startRendering();
  const channels = makeSeamlessLoop(rendered, Math.ceil(loopSeconds * SAMPLE_RATE), Math.floor(LOOP_XFADE * SAMPLE_RATE));
  normalize(channels);
  return { url: wavUrl(channels, SAMPLE_RATE), labels: reading.labels, modifiers: reading.modifiers, durationSeconds: loopSeconds };
}

// Equal-power crossfade of the rendered tail back onto the start: the last sample of the loop
// leads straight into the first, so repeating it never clicks, dips, or goes silent.
function makeSeamlessLoop(buffer: AudioBuffer, loopLen: number, xfade: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(loopLen);
    dst.set(src.subarray(0, loopLen));
    for (let i = 0; i < xfade; i++) {
      const x = (i / xfade) * (Math.PI / 2);
      dst[i] = src[i] * Math.sin(x) + src[loopLen + i] * Math.cos(x);
    }
    out.push(dst);
  }
  return out;
}

// Brings every track to a consistent loudness (so a "gentle drizzle" isn't inaudible next to a
// built-in track), then soft-clips any peaks — thunder, pops — instead of hard-clipping them.
function normalize(channels: Float32Array[]) {
  let sum = 0;
  let count = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { sum += ch[i] * ch[i]; count++; }
  const rms = Math.sqrt(sum / Math.max(1, count));
  if (rms < 1e-6) return;
  const scale = 0.13 / rms;
  const knee = 0.75;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * scale;
      const a = Math.abs(v);
      ch[i] = a <= knee ? v : Math.sign(v) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
    }
  }
}

function wavUrl(channels: Float32Array[], sampleRate: number): string {
  const numChannels = channels.length;
  const samples = channels[0].length;
  const blockAlign = numChannels * 2;
  const dataSize = samples * blockAlign;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
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
  let offset = 44;
  for (let i = 0; i < samples; i++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, Math.max(-1, Math.min(1, channels[c][i])) * 0x7fff, true);
      offset += 2;
    }
  }
  return URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
}
