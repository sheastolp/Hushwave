import { useEffect, useMemo, useRef, useState } from "react";
import { generateAmbientTrack, generateAmbientTrackViaApi, generateAmbientTrackViaFreesound, readPrompt, SoundApiError, type GeneratedTrack } from "@/lib/generateAmbient";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  AudioLines,
  Check,
  Clock3,
  Disc3,
  Headphones,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";

type Sound = {
  id: string;
  title: string;
  subtitle: string;
  tags: string[];
  color: string;
  duration: string;
  source?: string;
};

type LoopMode = "track" | "playlist" | "off";
type GenerationMode = "offline" | "freesound" | "elevenlabs";

// Turns a MediaError code into something a user can actually act on, and always surfaces it —
// audio elements fail silently by default, which made it impossible to tell "nothing is wrong,
// it's just quiet" apart from "the file 404'd" or "the format isn't supported."
function reportAudioError(el: HTMLAudioElement, label: string) {
  const err = el.error;
  if (!err) return;
  const reason =
    err.code === MediaError.MEDIA_ERR_ABORTED
      ? "playback was aborted"
      : err.code === MediaError.MEDIA_ERR_NETWORK
      ? "a network error while loading the audio"
      : err.code === MediaError.MEDIA_ERR_DECODE
      ? "the audio file is corrupt or couldn't be decoded"
      : err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
      ? "the audio file couldn't be found or its format isn't supported"
      : "an unknown audio error";
  toast.error(`Audio error on “${label}”: ${reason}.`);
  console.error(`Hushwave audio element error on "${label}":`, err);
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// True when a keystroke is going into a text field / dropdown, so global shortcuts stay out of the way.
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox";
}

const sounds: Sound[] = [
  { id: "drift", title: "Hushwave Drift", subtitle: "Warm pads · soft tape · 58 BPM", tags: ["sleep", "focus", "original"], color: "from-violet-500/60 to-indigo-900/70", duration: "0:30 loop", source: "/audio/drift.wav" },
  { id: "rain", title: "Window Rain", subtitle: "Steady rainfall · no thunder", tags: ["rain", "sleep", "nature"], color: "from-cyan-500/60 to-slate-900/80", duration: "∞", source: "/audio/rain.wav" },
  { id: "brown", title: "Brown Current", subtitle: "Low-frequency noise · even wash", tags: ["noise", "focus", "deep work"], color: "from-amber-500/60 to-stone-900/80", duration: "∞", source: "/audio/brown.wav" },
  { id: "cabin", title: "Night Cabin", subtitle: "Fireplace crackle · distant wind", tags: ["cozy", "reading", "nature"], color: "from-orange-500/60 to-rose-950/80", duration: "∞", source: "/audio/cabin.wav" },
  { id: "tide", title: "Slow Tide", subtitle: "Shoreline wash · wide stereo", tags: ["ocean", "sleep", "meditation"], color: "from-emerald-400/60 to-teal-950/80", duration: "∞", source: "/audio/tide.wav" },
  { id: "library", title: "After Hours Library", subtitle: "Room tone · pages · soft HVAC", tags: ["room tone", "study", "original"], color: "from-fuchsia-400/60 to-purple-950/80", duration: "∞", source: "/audio/library.wav" },
];

const VOLUME_KEY = "hushwave:defaultVolume";
const LOOP_KEY = "hushwave:defaultLoopMode";
const SLEEP_KEY = "hushwave:defaultSleep";
const API_KEY_KEY = "hushwave:elevenLabsApiKey";
const FREESOUND_KEY_KEY = "hushwave:freesoundApiKey";
const GEN_MODE_KEY = "hushwave:generationMode";
const HIDDEN_BUILTIN_KEY = "hushwave:hiddenBuiltInIds";
const MIX_KEY = "hushwave:quickMix";
const OUTPUT_DEVICE_KEY = "hushwave:outputDeviceId";
const LAST_TRACK_KEY = "hushwave:lastTrackId";

type MixSlot = { soundId: string; volume: number };
const EMPTY_MIX: MixSlot[] = [
  { soundId: "", volume: 0 },
  { soundId: "", volume: 0 },
  { soundId: "", volume: 0 },
];

const prompts = [
  "rain on a tent with distant thunder",
  "crackling fireplace in a cozy cabin",
  "forest stream with birds at dawn",
  "moonlit night with crickets and soft wind",
  "busy café on a rainy afternoon",
  "deep space drone with soft chimes",
];

const GEN_LENGTH_KEY = "hushwave:generatedLength";
const GEN_LENGTHS = [30, 60, 120];

function formatLoopLength(seconds: number) {
  return seconds >= 60 ? `${seconds / 60} min loop` : `${seconds}s loop`;
}

const SLEEP_OPTIONS = ["Off", "15 min", "30 min", "60 min", "90 min"];

const LOOP_LABELS: Record<LoopMode, { label: string; hint: string }> = {
  track: { label: "Repeat this sound", hint: "Repeats the current sound forever. Click to switch to repeating the whole library." },
  playlist: { label: "Repeat library", hint: "Plays through the library, then starts over. Click to turn repeat off." },
  off: { label: "Repeat off", hint: "Stops when the current sound ends. Click to repeat the current sound." },
};

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD_KEY = isMac ? "⌘" : "Ctrl";

// Keep in sync with the version in package.json, src-tauri/tauri.conf.json, and
// src-tauri/Cargo.toml — those are what actually drive the build; this is just for display.
const APP_VERSION = "1.0.13";

export default function Home() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Sound>(() => sounds.find((s) => s.id === localStorage.getItem(LAST_TRACK_KEY)) ?? sounds[0]);
  const [playing, setPlaying] = useState(false);
  const [loopMode, setLoopMode] = useState<LoopMode>(() => (localStorage.getItem(LOOP_KEY) as LoopMode) || "track");
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    return stored ? Number(stored) : 68;
  });
  const [muted, setMuted] = useState(false);
  const [sleep, setSleep] = useState(() => {
    const stored = localStorage.getItem(SLEEP_KEY);
    return stored && SLEEP_OPTIONS.includes(stored) ? stored : "Off";
  });
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_KEY) || "");
  const [freesoundApiKey, setFreesoundApiKey] = useState(() => localStorage.getItem(FREESOUND_KEY_KEY) || "");
  const [generationMode, setGenerationMode] = useState<GenerationMode>(() => (localStorage.getItem(GEN_MODE_KEY) as GenerationMode) || "offline");
  const [genLength, setGenLength] = useState(() => {
    const stored = Number(localStorage.getItem(GEN_LENGTH_KEY));
    return GEN_LENGTHS.includes(stored) ? stored : 60;
  });
  // How many times each prompt has been generated this session, so generating the same prompt
  // again gives a fresh variation instead of the identical sound.
  const promptVariations = useRef(new Map<string, number>());
  const [customSounds, setCustomSounds] = useState<Sound[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [hiddenBuiltInIds, setHiddenBuiltInIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HIDDEN_BUILTIN_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [mixSlots, setMixSlots] = useState<MixSlot[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(MIX_KEY) || "null");
      return Array.isArray(stored) && stored.length === 3 ? stored : EMPTY_MIX;
    } catch {
      return EMPTY_MIX;
    }
  });
  const mixAudioRefs = useRef<(HTMLAudioElement | null)[]>([null, null, null]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedSounds, setGeneratedSounds] = useState<Sound[]>([]);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [trackDuration, setTrackDuration] = useState(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem(OUTPUT_DEVICE_KEY) || "");
  const [deviceDiagnostic, setDeviceDiagnostic] = useState<string | null>(null);

  // List available audio output devices for the picker in Preferences — lets you route
  // Hushwave's sound to a specific device (e.g. a virtual audio cable) instead of just the
  // system default, which OBS can then capture directly and reliably.
  //
  // This deliberately never asks for microphone access on its own: opening the mic makes
  // Windows treat Hushwave like a call (which can duck or reroute audio) and can pop a
  // permission prompt inside the WebView. Full device names are only unlocked when you press
  // "Show all devices" in Preferences.
  const refreshDevices = async (unlockNames = false) => {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
      setOutputDevices([]);
      setDeviceDiagnostic(
        `Audio device listing isn't available in this window (isSecureContext: ${window.isSecureContext}). This is a WebView limitation, not a Hushwave setting — try updating WebView2.`
      );
      return;
    }
    try {
      if (unlockNames) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          toast.error("Windows didn't allow access, so device names can't be listed. Playback through the system default still works.");
        }
      }
      const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default");
      setOutputDevices(outputs);
      setDeviceDiagnostic(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOutputDevices([]);
      setDeviceDiagnostic(`Couldn't list audio devices: ${message}`);
    }
  };

  useEffect(() => {
    const onChange = () => refreshDevices();
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(OUTPUT_DEVICE_KEY, outputDeviceId);
  }, [outputDeviceId]);

  const outputDeviceLabel = outputDeviceId
    ? outputDevices.find((d) => d.deviceId === outputDeviceId)?.label || "a specific device"
    : "System default";

  // Applies the chosen output device to every audio element Hushwave uses. If the saved device
  // is gone (unplugged, renamed, or a virtual cable that was uninstalled), switching to it fails
  // — so fall back to the system default instead of leaving playback silent or stuck.
  // setSinkId isn't in every TS lib version's DOM types yet, hence the local casts.
  useEffect(() => {
    const elements = [audioRef.current, ...mixAudioRefs.current].filter((el): el is HTMLAudioElement => !!el);
    let reported = false;
    for (const el of elements) {
      const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof withSink.setSinkId !== "function") continue;
      withSink.setSinkId(outputDeviceId).catch((err: unknown) => {
        console.error("Hushwave setSinkId error:", err);
        if (reported) return;
        reported = true;
        if (outputDeviceId) {
          setOutputDeviceId("");
          toast.error("Your chosen audio output device isn't available any more — switched back to the system default.");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`Couldn't use the system default audio output: ${message}`);
        }
      });
    }
  }, [outputDeviceId, active]);

  // Plays a short two-note chime through the currently selected output, independent of the
  // library — the quickest way to tell "Hushwave isn't making sound" apart from "the sound is
  // going somewhere you're not listening".
  const playTestSound = async () => {
    try {
      const sr = 44100;
      const ctx = new OfflineAudioContext(1, sr * 1.2, sr);
      [660, 880].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, i * 0.35);
        g.gain.linearRampToValueAtTime(0.5, i * 0.35 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, i * 0.35 + 0.8);
        o.connect(g).connect(ctx.destination);
        o.start(i * 0.35);
        o.stop(i * 0.35 + 0.85);
      });
      const rendered = await ctx.startRendering();
      const data = rendered.getChannelData(0);
      const view = new DataView(new ArrayBuffer(44 + data.length * 2));
      const w = (o: number, t: string) => { for (let i = 0; i < t.length; i++) view.setUint8(o + i, t.charCodeAt(i)); };
      w(0, "RIFF"); view.setUint32(4, 36 + data.length * 2, true); w(8, "WAVEfmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sr, true); view.setUint32(28, sr * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      w(36, "data"); view.setUint32(40, data.length * 2, true);
      data.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
      const url = URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
      const el = new Audio(url) as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (outputDeviceId && typeof el.setSinkId === "function") await el.setSinkId(outputDeviceId);
      el.volume = 1;
      el.onended = () => URL.revokeObjectURL(url);
      await el.play();
      toast(`Test sound sent to: ${outputDeviceLabel}. Didn't hear it? Check that output in the Windows volume mixer, or pick another one here.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Couldn't play the test sound: ${message}`);
      console.error("Hushwave test sound error:", err);
    }
  };

  // Single source of truth for actually driving the <audio> element: whenever the active
  // track or the playing/paused intent changes, sync the real element to match. This is what
  // makes selectSound/togglePlay/step/generate all "just work" without each one having to
  // remember to call .play()/.pause() itself.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !active.source) return;
    const resolvedSrc = new URL(active.source, window.location.href).href;
    if (el.src !== resolvedSrc) {
      el.src = active.source;
      setCurrentTime(0);
      setTrackDuration(0);
    }
    if (playing) {
      el.play().catch((err: unknown) => {
        setPlaying(false);
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Couldn't play “${active.title}”: ${message}`);
        console.error("Hushwave playback error:", err);
      });
    } else {
      el.pause();
    }
  }, [active, playing]);

  // Remember the last built-in track so the app reopens where you left off. Generated and
  // custom tracks don't survive a restart, so there's nothing to come back to for those.
  useEffect(() => {
    if (sounds.some((s) => s.id === active.id)) localStorage.setItem(LAST_TRACK_KEY, active.id);
  }, [active]);

  // Apply volume/mute to the actual <audio> elements whenever they change, and persist volume as the default.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
      audioRef.current.muted = muted;
    }
    mixAudioRefs.current.forEach((el) => {
      if (el) el.muted = muted;
    });
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume, muted]);

  useEffect(() => {
    localStorage.setItem(LOOP_KEY, loopMode);
  }, [loopMode]);

  useEffect(() => {
    localStorage.setItem(SLEEP_KEY, sleep);
  }, [sleep]);

  useEffect(() => {
    localStorage.setItem(API_KEY_KEY, apiKey);
  }, [apiKey]);

  useEffect(() => {
    localStorage.setItem(FREESOUND_KEY_KEY, freesoundApiKey);
  }, [freesoundApiKey]);

  useEffect(() => {
    localStorage.setItem(GEN_MODE_KEY, generationMode);
  }, [generationMode]);

  useEffect(() => {
    localStorage.setItem(GEN_LENGTH_KEY, String(genLength));
  }, [genLength]);

  useEffect(() => {
    localStorage.setItem(HIDDEN_BUILTIN_KEY, JSON.stringify(hiddenBuiltInIds));
  }, [hiddenBuiltInIds]);

  useEffect(() => {
    localStorage.setItem(MIX_KEY, JSON.stringify(mixSlots));
  }, [mixSlots]);

  // Drives the three Quick Mix background layers — each with its own looped <audio> element
  // and volume, layered on top of the main track. They follow the main play/pause button so
  // one press (or the sleep timer) silences everything. Looks across generated, custom, and
  // built-in sounds directly rather than the later `allSounds` memo, since this effect runs
  // before that's declared.
  useEffect(() => {
    const pool = [...generatedSounds, ...customSounds, ...sounds];
    mixSlots.forEach((slot, i) => {
      const el = mixAudioRefs.current[i];
      const sound = pool.find((s) => s.id === slot.soundId);
      if (!el || !sound?.source || slot.volume <= 0 || !playing) {
        el?.pause();
        return;
      }
      const resolvedSrc = new URL(sound.source, window.location.href).href;
      if (el.src !== resolvedSrc) el.src = sound.source;
      el.loop = true;
      el.volume = slot.volume / 100;
      el.play().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Quick mix couldn't play “${sound.title}”: ${message}`);
        console.error("Hushwave quick-mix playback error:", err);
      });
    });
  }, [mixSlots, generatedSounds, customSounds, playing]);

  // Sleep timer: counts down only while something is playing. Pausing cancels it; pressing
  // play again (or picking a new duration) starts a fresh countdown. Switching tracks doesn't reset it.
  const sleepMinutes = sleep === "Off" ? 0 : parseInt(sleep, 10);
  useEffect(() => {
    if (!sleepMinutes || !playing) {
      setSleepEndsAt(null);
      return;
    }
    setSleepEndsAt((prev) => prev ?? Date.now() + sleepMinutes * 60 * 1000);
  }, [sleepMinutes, playing]);

  useEffect(() => {
    if (sleepEndsAt === null) return;
    setNow(Date.now());
    const interval = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= sleepEndsAt) {
        setPlaying(false);
        toast("Sleep timer finished — playback stopped.");
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [sleepEndsAt]);

  const changeSleep = (value: string) => {
    setSleepEndsAt(null);
    setSleep(value);
  };

  const cycleSleep = () => changeSleep(SLEEP_OPTIONS[(SLEEP_OPTIONS.indexOf(sleep) + 1) % SLEEP_OPTIONS.length]);

  const sleepRemaining = sleepEndsAt !== null ? Math.max(0, (sleepEndsAt - now) / 1000) : null;

  // Generated tracks show up first, ahead of the built-in library.
  const allSounds = useMemo(
    () => [...generatedSounds, ...customSounds, ...sounds.filter((s) => !hiddenBuiltInIds.includes(s.id))],
    [generatedSounds, customSounds, hiddenBuiltInIds]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allSounds;
    return allSounds.filter((sound) => [sound.title, sound.subtitle, ...sound.tags].join(" ").toLowerCase().includes(q));
  }, [query, allSounds]);

  // Clicking the card of the sound that's already loaded toggles play/pause instead of
  // restarting it, so the card's own play/pause icon does what it shows.
  const selectSound = (sound: Sound) => {
    if (sound.id === active.id) {
      setPlaying((value) => !value);
      return;
    }
    setActive(sound);
    setPlaying(true);
  };

  const togglePlay = () => setPlaying((value) => !value);

  // Moves to the next/previous track *within the current queue*. This is a plain track-skip
  // control — it does not depend on, or change, loopMode.
  const step = (direction: 1 | -1) => {
    const list = filtered.length ? filtered : allSounds;
    if (list.length === 0) return;
    const currentIndex = list.findIndex((s) => s.id === active.id);
    const nextIndex = (currentIndex + direction + list.length) % list.length;
    setActive(list[nextIndex]);
    setPlaying(true);
  };

  const seek = (fraction: number) => {
    const el = audioRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return;
    el.currentTime = Math.min(Math.max(fraction, 0), 1) * el.duration;
    setCurrentTime(el.currentTime);
  };

  // Explicit, mode-driven behavior when a track finishes — deliberately not using the native
  // <audio loop> attribute, since relying on it here is what caused "Loop track" to sometimes
  // behave like it was advancing through the whole library instead of just repeating itself.
  const handleEnded = () => {
    if (loopMode === "track") {
      const el = audioRef.current;
      if (el) {
        el.currentTime = 0;
        el.play().catch((err: unknown) => {
          setPlaying(false);
          const message = err instanceof Error ? err.message : String(err);
          toast.error(`Couldn't loop “${active.title}”: ${message}`);
          console.error("Hushwave loop-restart error:", err);
        });
      }
    } else if (loopMode === "playlist") {
      step(1);
    } else {
      setPlaying(false);
    }
  };

  // Keyboard shortcuts and OS media keys (headset buttons, keyboard media keys, the Windows
  // media overlay). These handlers are registered once, so they read the latest callbacks
  // through a ref rather than closing over stale ones.
  const actionsRef = useRef({ togglePlay, step });
  actionsRef.current = { togglePlay, step };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector("[role=dialog]")) return;
      if (e.key === " ") {
        // Space on a focused button should press that button, not also toggle playback.
        if (e.target instanceof Element && e.target.closest("button, a, [role=button], [role=slider]")) return;
        e.preventDefault();
        actionsRef.current.togglePlay();
      } else if (e.key === "ArrowRight") {
        actionsRef.current.step(1);
      } else if (e.key === "ArrowLeft") {
        actionsRef.current.step(-1);
      } else if (e.key.toLowerCase() === "m") {
        setMuted((m) => !m);
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => setPlaying(true)],
      ["pause", () => setPlaying(false)],
      ["nexttrack", () => actionsRef.current.step(1)],
      ["previoustrack", () => actionsRef.current.step(-1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not every WebView supports every action — the rest still work.
      }
    }
  }, []);

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: active.title, artist: "Hushwave", album: active.subtitle });
  }, [active]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  const clearGenerated = () => {
    if (generatedSounds.some((s) => s.id === active.id)) setActive(sounds[0]);
    generatedSounds.forEach((s) => {
      if (s.source?.startsWith("blob:")) URL.revokeObjectURL(s.source);
    });
    setGeneratedSounds([]);
  };

  const clearCustomFiles = () => {
    if (customSounds.some((s) => s.id === active.id)) setActive(sounds[0]);
    customSounds.forEach((s) => {
      if (s.source?.startsWith("blob:")) URL.revokeObjectURL(s.source);
    });
    setCustomSounds([]);
  };

  // Removes one sound from the visible library, with an Undo in the toast. Built-in tracks are
  // hidden (also restorable from Preferences); generated and custom-file tracks are deleted
  // once the toast goes away, since they don't persist anyway. Also clears it out of any Quick
  // Mix slot pointing at it.
  const removeSound = (sound: Sound) => {
    const isBuiltIn = sounds.some((s) => s.id === sound.id);
    const wasGenerated = generatedSounds.some((s) => s.id === sound.id);
    const previousMix = mixSlots;
    if (isBuiltIn) {
      setHiddenBuiltInIds((prev) => (prev.includes(sound.id) ? prev : [...prev, sound.id]));
    } else {
      setGeneratedSounds((prev) => prev.filter((s) => s.id !== sound.id));
      setCustomSounds((prev) => prev.filter((s) => s.id !== sound.id));
    }
    setMixSlots((prev) => prev.map((slot) => (slot.soundId === sound.id ? { soundId: "", volume: 0 } : slot)));
    if (active.id === sound.id) {
      const remaining = allSounds.filter((s) => s.id !== sound.id);
      if (remaining.length) setActive(remaining[0]);
      else setPlaying(false);
    }

    let undone = false;
    const finalize = () => {
      if (!undone && !isBuiltIn && sound.source?.startsWith("blob:")) URL.revokeObjectURL(sound.source);
    };
    toast(isBuiltIn ? `Hid “${sound.title}” from your library.` : `Removed “${sound.title}”.`, {
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          if (isBuiltIn) setHiddenBuiltInIds((prev) => prev.filter((id) => id !== sound.id));
          else if (wasGenerated) setGeneratedSounds((prev) => [sound, ...prev]);
          else setCustomSounds((prev) => [sound, ...prev]);
          setMixSlots(previousMix);
        },
      },
      onAutoClose: finalize,
      onDismiss: finalize,
    });
  };

  const resetMix = () => {
    mixAudioRefs.current.forEach((el) => el?.pause());
    setMixSlots(EMPTY_MIX);
  };

  const addFiles = (files: File[]) => {
    const audioFiles = files.filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm)$/i.test(f.name));
    if (files.length && audioFiles.length === 0) {
      toast.error("Those don't look like audio files. Try MP3, WAV, OGG, FLAC, or M4A.");
      return;
    }
    if (audioFiles.length === 0) return;
    const palette = ["from-sky-400/60 to-blue-950/80", "from-rose-400/60 to-red-950/80", "from-teal-400/60 to-cyan-950/80", "from-amber-400/60 to-orange-950/80"];
    const added: Sound[] = audioFiles.map((file, i) => ({
      id: `custom-${Date.now()}-${i}`,
      title: file.name.replace(/\.[^/.]+$/, ""),
      subtitle: "Your file · added this session",
      tags: ["your files", "local"],
      color: palette[i % palette.length],
      duration: "local file",
      source: URL.createObjectURL(file),
    }));
    setCustomSounds((prev) => [...added, ...prev]);
    setActive(added[0]);
    setPlaying(true);
    const skipped = files.length - audioFiles.length;
    toast.success(
      (added.length > 1 ? `Added ${added.length} files to your library.` : `Added “${added[0].title}” to your library.`) +
        (skipped ? ` Skipped ${skipped} non-audio file${skipped > 1 ? "s" : ""}.` : "") +
        " They'll be gone when you close Hushwave."
    );
  };

  const handleFilesPicked = (fileList: FileList | null) => {
    if (fileList) addFiles(Array.from(fileList));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const missingKey =
    (generationMode === "elevenlabs" && !apiKey.trim()) || (generationMode === "freesound" && !freesoundApiKey.trim());

  const generate = () => {
    const text = prompt.trim();
    if (!text || generating) return;

    if (missingKey) {
      toast.error(`${generationMode === "elevenlabs" ? "ElevenLabs" : "Freesound"} needs an API key — add one in Preferences, or switch to the offline generator.`);
      return;
    }

    setGenerating(true);

    const key = text.toLowerCase();
    const variation = promptVariations.current.get(key) ?? 0;
    promptVariations.current.set(key, variation + 1);
    const baseTitle = text.replace(/^./, (c) => c.toUpperCase());
    const title = variation > 0 ? `${baseTitle} (take ${variation + 1})` : baseTitle;

    const addTrack = (source: string, subtitle: string, tags: string[] = ["generated", "original", "your prompt"], duration = "0:20 loop") => {
      const next: Sound = { id: `generated-${Date.now()}`, title, subtitle, tags, color: "from-lime-400/60 to-emerald-950/80", duration, source };
      setGeneratedSounds((prev) => [next, ...prev]);
      setActive(next);
      setPlaying(true);
    };

    const addOfflineTrack = (track: GeneratedTrack) =>
      addTrack(
        track.url,
        [track.labels.join(" + "), ...track.modifiers].join(" · ") + " · made on-device",
        ["generated", ...track.labels.slice(0, 2)],
        formatLoopLength(track.durationSeconds)
      );

    const runOffline = () => generateAmbientTrack(text, { durationSeconds: genLength, variation }).then(addOfflineTrack);

    const fallbackToOffline = (label: string, err: unknown) => {
      const message = err instanceof SoundApiError ? err.message : `The ${label} request failed.`;
      toast.error(`${label} generation failed — used the offline generator instead. (${message})`);
      return runOffline();
    };

    let task: Promise<void>;
    if (generationMode === "elevenlabs") {
      task = generateAmbientTrackViaApi(text, apiKey.trim()).then(
        (url) => addTrack(url, "Generated by ElevenLabs · from your prompt"),
        (err: unknown) => fallbackToOffline("ElevenLabs", err)
      );
    } else if (generationMode === "freesound") {
      task = generateAmbientTrackViaFreesound(text, freesoundApiKey.trim()).then(
        (url) => addTrack(url, "From Freesound (CC0) · matched to your prompt", ["freesound", "CC0", "your prompt"]),
        (err: unknown) => fallbackToOffline("Freesound", err)
      );
    } else {
      task = runOffline();
    }

    task
      .catch(() => toast.error("Sound generation failed."))
      .finally(() => setGenerating(false));
  };

  // What the Prompt studio badge/description actually says depends on where the audio is
  // really coming from — this used to just always claim "original by design" even when the
  // source was a real third-party recording or another company's AI service, which wasn't true.
  const sourceInfo =
    generationMode === "freesound"
      ? { badge: "CC0 recordings, not original", description: "Describe a mood, place, or texture. Hushwave searches Freesound for a real, CC0-licensed recording matching it — not a Hushwave original, but free and safe to use." }
      : generationMode === "elevenlabs"
      ? { badge: "AI-generated by ElevenLabs", description: "Describe a mood, place, or texture. Hushwave asks your ElevenLabs account to generate audio matching it — this is ElevenLabs' output, not an original Hushwave recording." }
      : { badge: "original · generated on-device", description: "Describe a place, mood, or mix of sounds — rain, thunder, fireplace, waves, stream, birds, crickets, wind, city, café, train, hum, drone, chimes, or a warm pad. Hushwave layers up to five of them and synthesizes a seamless loop right here on your device — nothing downloaded, nothing borrowed." };

  const promptReading = generationMode === "offline" && prompt.trim() ? readPrompt(prompt) : null;
  const promptTimesMade = promptVariations.current.get(prompt.trim().toLowerCase()) ?? 0;

  const progress = trackDuration > 0 ? Math.min(currentTime / trackDuration, 1) : 0;
  const mixInUse = mixSlots.some((s) => s.soundId && s.volume > 0);

  const sectionTitle = "mb-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40";
  const fieldLabel = "mb-2 text-xs text-white/60";
  const helpText = "mt-2 text-[11px] leading-4 text-white/40";
  const textInput = "w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60";

  return (
    <div
      className="min-h-screen bg-[#0b0c10] text-[#f3f0e8] selection:bg-violet-400/30"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes("Files")) setDraggingFiles(true);
      }}
    >
      <audio
        ref={audioRef}
        onEnded={handleEnded}
        onError={(e) => reportAudioError(e.currentTarget, active.title)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setTrackDuration(e.currentTarget.duration)}
        onLoadedMetadata={(e) => setTrackDuration(e.currentTarget.duration)}
      />
      {mixSlots.map((_, i) => (
        <audio key={i} ref={(el) => { mixAudioRefs.current[i] = el; }} onError={(e) => reportAudioError(e.currentTarget, "a Quick mix layer")} />
      ))}

      {draggingFiles && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[#0b0c10]/85 backdrop-blur-sm"
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => setDraggingFiles(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDraggingFiles(false);
            addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <div className="pointer-events-none flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-violet-300/60 px-16 py-12 text-center">
            <Upload size={32} className="text-violet-200" />
            <div className="font-display text-2xl">Drop audio files to add them</div>
            <div className="text-xs text-white/50">MP3, WAV, OGG, FLAC, M4A — they'll play right away</div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:radial-gradient(#fff_0.6px,transparent_0.6px)] [background-size:18px_18px]" />
      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/10 px-6 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400 text-[#17131f]"><Waves size={20} strokeWidth={2.5} /></div>
          <div>
            <div className="font-display text-lg font-semibold tracking-tight">Hushwave</div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-white/40">ambient player · v{APP_VERSION}</div>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200 md:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_#86efac]" />Built-in library: original, DMCA-safe</div>
        <button onClick={() => setPrefsOpen(true)} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 transition hover:border-white/25 hover:text-white"><Settings2 size={14} /> Preferences</button>
      </header>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-white/10 bg-[#12141b] text-[#f3f0e8]">
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription className="text-white/45">
              Saved on this device and applied right away.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-7 py-2">
            <section>
              <div className={sectionTitle}>Playback</div>
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs text-white/60"><span>Volume</span><span>{volume}%</span></div>
                  <input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 w-full accent-violet-300" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className={fieldLabel}>When a sound ends</div>
                    <Select value={loopMode} onValueChange={(v) => setLoopMode(v as LoopMode)}>
                      <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="track">Repeat it</SelectItem>
                        <SelectItem value="playlist">Play the next one</SelectItem>
                        <SelectItem value="off">Stop</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <div className={fieldLabel}>Sleep timer</div>
                    <Select value={sleep} onValueChange={changeSleep}>
                      <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SLEEP_OPTIONS.map((o) => <SelectItem key={o} value={o}>{o === "Off" ? "Off" : `Stop after ${o}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className={sectionTitle}>Prompt studio source</div>
              <Select value={generationMode} onValueChange={(v) => setGenerationMode(v as GenerationMode)}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline generator — free, no account (recommended)</SelectItem>
                  <SelectItem value="freesound">Freesound — free real recordings, needs a free key</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs — AI-generated, paid key</SelectItem>
                </SelectContent>
              </Select>
              {generationMode === "freesound" && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-white/60">
                    <span>Freesound API key</span>
                    <a href="https://freesound.org/apiv2/apply/" target="_blank" rel="noreferrer" className="text-violet-200 hover:text-white">Get a free key ↗</a>
                  </div>
                  <input type="password" autoFocus={!freesoundApiKey} value={freesoundApiKey} onChange={(e) => setFreesoundApiKey(e.target.value)} placeholder="Paste your Freesound key" className={textInput} />
                  <p className={helpText}>Free account, free key, no payment. Searches real Creative Commons (CC0-only) recordings matching your prompt. Stored only on this device.</p>
                </div>
              )}
              {generationMode === "elevenlabs" && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-white/60">
                    <span>ElevenLabs API key</span>
                    <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-violet-200 hover:text-white">Get a key ↗</a>
                  </div>
                  <input type="password" autoFocus={!apiKey} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste your ElevenLabs key" className={textInput} />
                  <p className={helpText}>Stored only on this device. Uses your own ElevenLabs account and may cost money on their end.</p>
                </div>
              )}
              {generationMode !== "offline" && <p className={helpText}>If an online request fails, Hushwave falls back to the offline generator automatically.</p>}
              <div className="mt-4">
                <div className={fieldLabel}>Length of on-device sounds</div>
                <Select value={String(genLength)} onValueChange={(v) => setGenLength(Number(v))}>
                  <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {GEN_LENGTHS.map((n) => <SelectItem key={n} value={String(n)}>{formatLoopLength(n)}{n === 60 ? " (recommended)" : ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className={helpText}>Every generated sound loops seamlessly. Longer loops repeat less noticeably but take a moment longer to make.</p>
              </div>
            </section>

            <section>
              <div className={sectionTitle}>Audio output</div>
              <Select value={outputDeviceId || "__default__"} onValueChange={(v) => setOutputDeviceId(v === "__default__" ? "" : v)}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">System default</SelectItem>
                  {outputDeviceId && !outputDevices.some((d) => d.deviceId === outputDeviceId) && (
                    <SelectItem value={outputDeviceId}>Saved device (not currently listed)</SelectItem>
                  )}
                  {outputDevices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 8)}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={playTestSound} className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/75 transition hover:border-white/30 hover:text-white"><Volume2 size={13} /> Play test sound</button>
                {outputDevices.every((d) => !d.label) && (
                  <button onClick={() => refreshDevices(true)} title="Windows only shares device names after a one-time microphone permission. Hushwave never records anything." className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/50 transition hover:border-white/25 hover:text-white">Show all devices by name</button>
                )}
              </div>
              {deviceDiagnostic ? (
                <p className="mt-2 text-[11px] leading-4 text-amber-300/80">{deviceDiagnostic}</p>
              ) : (
                <p className={helpText}>
                  Streaming with OBS? Send Hushwave to a virtual audio cable (like the free VB-Audio Virtual Cable) and capture that in OBS with a plain Audio Output Capture source.
                </p>
              )}
            </section>

            {(generatedSounds.length > 0 || customSounds.length > 0 || hiddenBuiltInIds.length > 0) && (
              <section>
                <div className={sectionTitle}>Library</div>
                <div className="space-y-2">
                  {generatedSounds.length > 0 && (
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <span className="text-xs text-white/60">Your generated sound{generatedSounds.length > 1 ? "s" : ""} ({generatedSounds.length})</span>
                      <button onClick={clearGenerated} className="text-xs text-violet-200 hover:text-white">Remove all</button>
                    </div>
                  )}
                  {customSounds.length > 0 && (
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <span className="text-xs text-white/60">Your added file{customSounds.length > 1 ? "s" : ""} ({customSounds.length})</span>
                      <button onClick={clearCustomFiles} className="text-xs text-violet-200 hover:text-white">Remove all</button>
                    </div>
                  )}
                  {hiddenBuiltInIds.length > 0 && (
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs text-white/60">Hidden library sounds ({hiddenBuiltInIds.length})</span>
                        <button onClick={() => setHiddenBuiltInIds([])} className="text-xs text-violet-200 hover:text-white">Restore all</button>
                      </div>
                      <div className="space-y-1.5">
                        {sounds.filter((s) => hiddenBuiltInIds.includes(s.id)).map((s) => (
                          <div key={s.id} className="flex items-center justify-between text-[11px] text-white/50">
                            <span>{s.title}</span>
                            <button onClick={() => setHiddenBuiltInIds((prev) => prev.filter((id) => id !== s.id))} className="text-violet-200 hover:text-white">Restore</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section>
              <div className={sectionTitle}>Keyboard shortcuts</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-white/60">
                {[
                  ["Space", "Play / pause"],
                  ["← →", "Previous / next sound"],
                  ["M", "Mute / unmute"],
                  [`${MOD_KEY} K  or  /`, "Search"],
                ].map(([keys, label]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <span>{label}</span>
                    <kbd className="rounded-md border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/50">{keys}</kbd>
                  </div>
                ))}
              </div>
              <p className={helpText}>Your keyboard's media keys and headset buttons work too.</p>
            </section>
          </div>
          <DialogFooter>
            <button onClick={() => setPrefsOpen(false)} className="rounded-xl bg-violet-300 px-4 py-2 text-sm font-semibold text-[#17131f] hover:bg-violet-200">Done</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="relative z-10 mx-auto grid max-w-[1440px] gap-8 px-6 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-12">
        <section>
          <div className="mb-8 max-w-2xl">
            <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-violet-300"><Sparkles size={14} /> Sound, made quiet</div>
            <h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-white sm:text-7xl">Find your<br /><span className="text-white/45">background.</span></h1>
            <p className="mt-5 max-w-lg text-sm leading-6 text-white/55">Click any sound to start it. Layer extras with Quick mix, set a sleep timer, or describe a new soundscape below.</p>
          </div>
          <div className="mb-8 flex max-w-xl items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 shadow-2xl shadow-black/20 focus-within:border-violet-300/60 focus-within:bg-white/[0.07]">
            <Search size={18} className="text-white/35" />
            <input
              ref={searchInputRef}
              aria-label="Search ambient sounds"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                } else if (e.key === "Enter" && filtered[0]) {
                  selectSound(filtered[0]);
                }
              }}
              placeholder="Search rain, focus, ocean, cozy…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30"
            />
            {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16} className="text-white/35 hover:text-white" /></button>}
            <kbd className="hidden rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/30 sm:block">{MOD_KEY} K</kbd>
          </div>

          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-medium">Sound library <span className="ml-2 text-sm font-normal text-white/30">{filtered.length}</span></h2>
            <button onClick={() => fileInputRef.current?.click()} title="Or drag audio files anywhere onto the window" className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/25 hover:text-white"><Plus size={13} /> Add your own files</button>
          </div>
          <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={(e) => handleFilesPicked(e.target.files)} className="hidden" />
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((sound) => {
              const isActive = active.id === sound.id;
              const isBuiltIn = sounds.some((s) => s.id === sound.id);
              return (
                <div
                  key={sound.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isActive && playing}
                  aria-label={isActive && playing ? `Pause ${sound.title}` : `Play ${sound.title}`}
                  onClick={() => selectSound(sound)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      selectSound(sound);
                    }
                  }}
                  className={`group relative flex cursor-pointer items-center gap-4 rounded-2xl border p-3 text-left outline-none transition duration-200 hover:-translate-y-0.5 hover:border-white/25 focus-visible:border-violet-300/80 focus-visible:ring-2 focus-visible:ring-violet-300/40 ${isActive ? "border-violet-300/70 bg-violet-300/[0.08]" : "border-white/10 bg-white/[0.035]"}`}
                >
                  <div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${sound.color} shadow-inner`}>
                    {isActive && playing ? <span className="flex h-5 items-end gap-0.5">{[0, 1, 2].map((b) => <span key={b} className="w-1 animate-pulse rounded-full bg-white/85" style={{ height: `${[60, 100, 40][b]}%`, animationDelay: `${b * 150}ms` }} />)}</span> : <AudioLines size={22} className="text-white/80" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white/90">{sound.title}</div>
                    <div className="mt-1 truncate text-xs text-white/40">{sound.subtitle}</div>
                    <div className="mt-2 flex gap-1.5">{sound.tags.slice(0, 2).map((tag) => <button key={tag} onClick={(e) => { e.stopPropagation(); setQuery(tag); }} title={`Show all “${tag}” sounds`} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/40 hover:bg-white/[0.14] hover:text-white/70">{tag}</button>)}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-white/30">
                    <span className="text-[10px]">{sound.duration === "∞" ? "loop" : sound.duration}</span>
                    <span className={`grid h-7 w-7 place-items-center rounded-full transition ${isActive ? "bg-violet-300 text-[#17131f]" : "bg-white/10 group-hover:bg-white/20"}`}>{isActive && playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeSound(sound); }}
                    aria-label={isBuiltIn ? `Hide ${sound.title} from library` : `Remove ${sound.title}`}
                    title={isBuiltIn ? "Hide from library (you can undo or restore it later)" : "Remove (you can undo)"}
                    className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-black/50 text-white/60 opacity-0 transition hover:bg-red-500/80 hover:text-white focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && query && (
            <div className="rounded-2xl border border-dashed border-white/15 py-12 text-center text-sm text-white/40">
              No sounds match “{query}”. Try{" "}
              {["rain", "focus", "sleep"].map((s, i) => (
                <span key={s}>
                  <button onClick={() => setQuery(s)} className="text-violet-200 hover:text-white">“{s}”</button>
                  {i < 2 ? (i === 1 ? ", or " : ", ") : ""}
                </span>
              ))}
              {" "}— or <button onClick={() => { setPrompt(query); promptInputRef.current?.focus(); }} className="text-violet-200 hover:text-white">make one from your search</button>.
            </div>
          )}
          {allSounds.length === 0 && !query && (
            <div className="rounded-2xl border border-dashed border-white/15 py-12 text-center text-sm text-white/40">
              Your library is empty.{" "}
              <button onClick={() => setHiddenBuiltInIds([])} className="text-violet-200 hover:text-white">Restore the built-in sounds</button>
              {" "}or add your own files.
            </div>
          )}

          <div className="mt-10 overflow-hidden rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-400/[0.14] via-white/[0.03] to-emerald-300/[0.06] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-violet-200"><Sparkles size={14} /> Prompt studio</div>
                <h2 className="font-display text-2xl">Make a soundscape</h2>
                <p className="mt-2 max-w-md text-xs leading-5 text-white/45">{sourceInfo.description}</p>
              </div>
              <button onClick={() => setPrefsOpen(true)} title="Change where generated sounds come from" className="hidden rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-3 py-2 text-[10px] text-emerald-200 transition hover:border-emerald-200/40 sm:block"><Check size={13} className="mr-1 inline" /> {sourceInfo.badge} · change</button>
            </div>
            {missingKey && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2.5 text-xs text-amber-100">
                <AlertTriangle size={14} className="shrink-0" />
                <span className="flex-1">{generationMode === "elevenlabs" ? "ElevenLabs" : "Freesound"} needs an API key before it can generate.</span>
                <button onClick={() => setPrefsOpen(true)} className="font-semibold hover:text-white">Add key</button>
                <button onClick={() => setGenerationMode("offline")} className="text-amber-100/70 hover:text-white">Use offline instead</button>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <input ref={promptInputRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} placeholder="e.g. moonlit greenhouse with soft rain" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60" />
              <button onClick={generate} disabled={generating || !prompt.trim() || missingKey} className="flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 py-3 text-sm font-semibold text-[#17131f] transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">{generating ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <><Sparkles size={15} /> {promptTimesMade > 0 ? "New variation" : "Generate"}</>}</button>
            </div>
            {promptReading && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                <span className="text-white/30">Will layer:</span>
                {promptReading.labels.map((l) => <span key={l} className="rounded-full border border-violet-300/25 bg-violet-300/10 px-2 py-0.5 text-violet-100/80">{l}</span>)}
                {promptReading.modifiers.map((m) => <span key={m} className="rounded-full border border-white/10 px-2 py-0.5 text-white/45">{m}</span>)}
                <span className="text-white/30">· {formatLoopLength(genLength)}</span>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-white/30">Try:</span>
              {prompts.map((item) => <button key={item} onClick={() => { setPrompt(item); promptInputRef.current?.focus(); }} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/45 hover:border-white/25 hover:text-white/75">{item}</button>)}
            </div>
            {generatedSounds[0] && <div className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><Check size={14} /> Added “{generatedSounds[0].title}” to the top of your library</div>}
          </div>
        </section>

        <aside className="lg:pt-16">
          <div className="sticky top-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#12141b]/90 shadow-2xl shadow-black/40 backdrop-blur-xl">
            <div className={`relative flex h-56 items-end bg-gradient-to-br ${active.color} p-6`}>
              <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_20%,white_0,transparent_32%),linear-gradient(120deg,transparent,rgba(255,255,255,.12))]" />
              <div className="relative">
                <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/60"><Disc3 size={13} className={playing ? "animate-spin [animation-duration:4s]" : ""} /> {playing ? "now playing" : "paused"}</div>
                <h2 className="font-display text-3xl font-medium tracking-tight">{active.title}</h2>
                <p className="mt-1 text-xs text-white/55">{active.subtitle}</p>
              </div>
              <div className="absolute right-6 top-6 grid h-12 w-12 place-items-center rounded-2xl border border-white/20 bg-black/10 text-white/70"><Headphones size={20} /></div>
            </div>
            <div className="p-6">
              <div className="mb-2 flex items-center justify-between text-[10px] text-white/40">
                <span>{formatTime(currentTime)}</span>
                <span>{trackDuration > 0 ? formatTime(trackDuration) : "--:--"}</span>
              </div>
              <div
                role="slider"
                tabIndex={0}
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.round(trackDuration) || 0}
                aria-valuenow={Math.round(currentTime)}
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(trackDuration)}`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  seek((e.clientX - rect.left) / rect.width);
                }}
                onKeyDown={(e) => {
                  if (!trackDuration) return;
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    e.stopPropagation();
                    seek((currentTime + (e.key === "ArrowRight" ? 5 : -5)) / trackDuration);
                  }
                }}
                className="group/seek -my-1.5 cursor-pointer py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-violet-300/40"
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10 transition-all group-hover/seek:h-2">
                  <div className="h-full rounded-full bg-violet-300" style={{ width: `${progress * 100}%` }} />
                </div>
              </div>
              <div className="mt-6 flex items-center justify-center gap-5">
                <button onClick={() => step(-1)} className="text-white/40 hover:text-white" aria-label="Previous sound" title="Previous sound (←)"><SkipBack size={18} /></button>
                <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"} className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#17131f] shadow-xl shadow-white/10 transition hover:scale-105">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}</button>
                <button onClick={() => step(1)} className="text-white/40 hover:text-white" aria-label="Next sound" title="Next sound (→)"><SkipForward size={19} /></button>
              </div>
              <div className="mt-7 grid grid-cols-2 gap-2">
                <button
                  onClick={() => setLoopMode(loopMode === "track" ? "playlist" : loopMode === "playlist" ? "off" : "track")}
                  title={LOOP_LABELS[loopMode].hint}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${loopMode !== "off" ? "border-violet-300/40 bg-violet-300/10 text-violet-200" : "border-white/10 text-white/45 hover:border-white/25 hover:text-white"}`}
                >
                  {loopMode === "track" ? <Repeat1 size={14} /> : <Repeat size={14} />} {LOOP_LABELS[loopMode].label}
                </button>
                <button
                  onClick={cycleSleep}
                  title={sleep === "Off" ? "Stop playback automatically after a while. Click to cycle 15 / 30 / 60 / 90 min." : `Stops after ${sleep}${playing ? "" : " of playback"}. Click to change.`}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${sleep !== "Off" ? "border-violet-300/40 bg-violet-300/10 text-violet-200" : "border-white/10 text-white/45 hover:border-white/25 hover:text-white"}`}
                >
                  <Clock3 size={14} />
                  {sleep === "Off" ? "Sleep timer off" : sleepRemaining !== null ? `Stops in ${formatTime(sleepRemaining)}` : `Sleep: ${sleep}`}
                </button>
              </div>
              <div className="mt-7 flex items-center gap-3">
                <button onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute (M)" : "Mute (M)"} className={muted ? "text-amber-300 hover:text-amber-200" : "text-white/35 hover:text-white"}>
                  {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(e) => { setVolume(Number(e.target.value)); setMuted(false); }} className={`h-1 flex-1 accent-violet-300 ${muted ? "opacity-40" : ""}`} />
                <span className="w-10 text-right text-[11px] text-white/35">{muted ? "muted" : `${volume}%`}</span>
              </div>
              {outputDeviceId && (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-[11px] text-amber-100">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={outputDeviceLabel}>Sound is going to {outputDeviceLabel}, not your default speakers.</span>
                  <button onClick={() => setOutputDeviceId("")} className="shrink-0 font-semibold hover:text-white">Use default</button>
                </div>
              )}
              <div className="mt-7 border-t border-white/10 pt-5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs text-white/60"><SlidersHorizontal size={14} /> Quick mix</span>
                  {mixInUse && <button onClick={resetMix} className="text-[11px] text-violet-200 hover:text-white">Clear</button>}
                </div>
                <p className="mb-3 text-[11px] leading-4 text-white/35">Layer up to three extra sounds under the main one — e.g. rain over a fireplace.</p>
                <div className="space-y-3">
                  {mixSlots.map((slot, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <select aria-label={`Quick mix layer ${i + 1}`} value={slot.soundId} onChange={(e) => setMixSlots((prev) => prev.map((s, j) => (j === i ? { soundId: e.target.value, volume: e.target.value ? s.volume || 30 : 0 } : s)))} className="w-32 shrink-0 truncate rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/70 outline-none focus:border-violet-300/60">
                        <option value="">Add a layer…</option>
                        {allSounds.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                      </select>
                      <input aria-label={`Quick mix layer ${i + 1} volume`} type="range" min="0" max="100" value={slot.volume} disabled={!slot.soundId} onChange={(e) => setMixSlots((prev) => prev.map((s, j) => (j === i ? { ...s, volume: Number(e.target.value) } : s)))} className="h-1 flex-1 accent-violet-300 disabled:opacity-30" />
                      <span className="w-8 text-right text-[10px] text-white/30">{slot.soundId ? `${slot.volume}%` : ""}</span>
                    </div>
                  ))}
                </div>
                {mixInUse && !playing && <p className="mt-3 text-[11px] text-white/35">Press play to hear your mix.</p>}
              </div>
            </div>
          </div>
        </aside>
      </main>
      <footer className="relative z-10 mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-white/10 px-6 py-6 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between lg:px-10">
        <div>Hushwave's built-in library is original and DMCA-safe. Optional online sources (Freesound, ElevenLabs) bring in content licensed by you, not Hushwave.</div>
        <div className="flex items-center gap-4">
          <span>Space play/pause · ← → skip · M mute · {MOD_KEY} K search</span>
        </div>
      </footer>
    </div>
  );
}
