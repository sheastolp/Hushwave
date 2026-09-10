import { useEffect, useMemo, useRef, useState } from "react";
import { generateAmbientTrack, generateAmbientTrackViaApi, generateAmbientTrackViaFreesound, SoundApiError } from "@/lib/generateAmbient";
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
  AudioLines,
  Check,
  ChevronDown,
  Clock3,
  Disc3,
  Headphones,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Volume2,
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

type MixSlot = { soundId: string; volume: number };
const EMPTY_MIX: MixSlot[] = [
  { soundId: "", volume: 0 },
  { soundId: "", volume: 0 },
  { soundId: "", volume: 0 },
];

const prompts = ["rain on a skylight", "late-night train cabin", "warm analog room tone"];

// Keep in sync with the version in package.json, src-tauri/tauri.conf.json, and
// src-tauri/Cargo.toml — those are what actually drive the build; this is just for display.
const APP_VERSION = "1.0.10";

export default function Home() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<Sound>(sounds[0]);
  const [playing, setPlaying] = useState(false);
  const [loopMode, setLoopMode] = useState<"track" | "playlist" | "off">(
    () => (localStorage.getItem(LOOP_KEY) as "track" | "playlist" | "off") || "track"
  );
  const [volume, setVolume] = useState(() => {
    const stored = localStorage.getItem(VOLUME_KEY);
    return stored ? Number(stored) : 68;
  });
  const [sleep, setSleep] = useState(() => localStorage.getItem(SLEEP_KEY) || "Off");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_KEY) || "");
  const [freesoundApiKey, setFreesoundApiKey] = useState(() => localStorage.getItem(FREESOUND_KEY_KEY) || "");
  const [generationMode, setGenerationMode] = useState<"offline" | "freesound" | "elevenlabs">(
    () => (localStorage.getItem(GEN_MODE_KEY) as "offline" | "freesound" | "elevenlabs") || "offline"
  );
  const [customSounds, setCustomSounds] = useState<Sound[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDeviceId, setOutputDeviceId] = useState(() => localStorage.getItem(OUTPUT_DEVICE_KEY) || "");
  const [deviceDiagnostic, setDeviceDiagnostic] = useState<string | null>(null);

  // List available audio output devices for the picker in Preferences — lets you route
  // Hushwave's sound to a specific device (e.g. a virtual audio cable) instead of just the
  // system default, which OBS can then capture directly and reliably.
  useEffect(() => {
    const refresh = async () => {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") {
        setOutputDevices([]);
        setDeviceDiagnostic(
          `Audio device listing isn't available in this window (isSecureContext: ${window.isSecureContext}). This is a WebView limitation, not a Hushwave setting — try updating WebView2.`
        );
        return;
      }
      try {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let outputs = devices.filter((d) => d.kind === "audiooutput");
        // Some WebView engines blank out device info entirely without a permission grant, even
        // for outputs (which normally don't need one in a real browser). Try once to unlock it.
        if (outputs.length === 0 || outputs.every((d) => !d.label && !d.deviceId)) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((t) => t.stop());
            devices = await navigator.mediaDevices.enumerateDevices();
            outputs = devices.filter((d) => d.kind === "audiooutput");
          } catch {
            // No input device, or permission denied — fall through with whatever we already have.
          }
        }
        setOutputDevices(outputs);
        setDeviceDiagnostic(outputs.length === 0 ? "The system reported zero audio output devices when asked — this looks like a WebView2/Windows issue outside Hushwave." : null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setOutputDevices([]);
        setDeviceDiagnostic(`Couldn't list audio devices: ${message}`);
      }
    };
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, []);

  useEffect(() => {
    localStorage.setItem(OUTPUT_DEVICE_KEY, outputDeviceId);
  }, [outputDeviceId]);

  // Applies the chosen output device to every audio element Hushwave uses. setSinkId isn't in
  // every TS lib version's DOM types yet, hence the local casts.
  useEffect(() => {
    const elements = [audioRef.current, ...mixAudioRefs.current].filter((el): el is HTMLAudioElement => !!el);
    for (const el of elements) {
      const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof withSink.setSinkId !== "function") continue;
      withSink.setSinkId(outputDeviceId || "default").catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Couldn't switch audio output device: ${message}`);
        console.error("Hushwave setSinkId error:", err);
      });
    }
  }, [outputDeviceId, active]);

  // Single source of truth for actually driving the <audio> element: whenever the active
  // track or the playing/paused intent changes, sync the real element to match. This is what
  // makes selectSound/togglePlay/step/generate all "just work" without each one having to
  // remember to call .play()/.pause() itself.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !active.source) return;
    const resolvedSrc = new URL(active.source, window.location.href).href;
    if (el.src !== resolvedSrc) el.src = active.source;
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

  // Apply volume to the actual <audio> element whenever it changes, and persist as the default.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
    localStorage.setItem(VOLUME_KEY, String(volume));
  }, [volume]);

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
    localStorage.setItem(HIDDEN_BUILTIN_KEY, JSON.stringify(hiddenBuiltInIds));
  }, [hiddenBuiltInIds]);

  useEffect(() => {
    localStorage.setItem(MIX_KEY, JSON.stringify(mixSlots));
  }, [mixSlots]);

  // Drives the three Quick Mix background layers — independent of the main "now playing"
  // track, each with its own looped <audio> element and volume. Looks across generated,
  // custom, and built-in sounds directly rather than the later `allSounds` memo, since this
  // effect runs before that's declared.
  useEffect(() => {
    const pool = [...generatedSounds, ...customSounds, ...sounds];
    mixSlots.forEach((slot, i) => {
      const el = mixAudioRefs.current[i];
      const sound = pool.find((s) => s.id === slot.soundId);
      if (!el || !sound?.source || slot.volume <= 0) {
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
  }, [mixSlots, generatedSounds, customSounds]);

  // Sleep timer: stop playback after the chosen duration.
  useEffect(() => {
    if (sleep === "Off") return;
    const minutes = sleep === "30 min" ? 30 : 60;
    const timer = window.setTimeout(() => {
      setPlaying(false);
    }, minutes * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [sleep, active]);

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

  const selectSound = (sound: Sound) => {
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
    selectSound(list[nextIndex]);
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

  // Removes one sound from the visible library. Built-in tracks are hidden (reversible, from
  // Preferences); generated and custom-file tracks are fully deleted since they don't persist
  // anyway. Also clears it out of any Quick Mix slot pointing at it.
  const removeSound = (sound: Sound) => {
    const isBuiltIn = sounds.some((s) => s.id === sound.id);
    if (isBuiltIn) {
      setHiddenBuiltInIds((prev) => (prev.includes(sound.id) ? prev : [...prev, sound.id]));
    } else {
      if (sound.source?.startsWith("blob:")) URL.revokeObjectURL(sound.source);
      setGeneratedSounds((prev) => prev.filter((s) => s.id !== sound.id));
      setCustomSounds((prev) => prev.filter((s) => s.id !== sound.id));
    }
    setMixSlots((prev) => prev.map((slot) => (slot.soundId === sound.id ? { soundId: "", volume: 0 } : slot)));
    if (active.id === sound.id) {
      const remaining = allSounds.filter((s) => s.id !== sound.id);
      if (remaining.length) setActive(remaining[0]);
    }
  };

  const resetMix = () => {
    mixAudioRefs.current.forEach((el) => el?.pause());
    setMixSlots(EMPTY_MIX);
  };

  const handleFilesPicked = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const palette = ["from-sky-400/60 to-blue-950/80", "from-rose-400/60 to-red-950/80", "from-teal-400/60 to-cyan-950/80", "from-amber-400/60 to-orange-950/80"];
    const added: Sound[] = Array.from(fileList).map((file, i) => ({
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
    toast.success(added.length > 1 ? `Added ${added.length} files to your library.` : `Added “${added[0].title}” to your library.`);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const generate = () => {
    const text = prompt.trim();
    if (!text) return;

    if (generationMode === "elevenlabs" && !apiKey.trim()) {
      toast.error("ElevenLabs is selected, but no API key is set — add one in Preferences, or switch generation source.");
      return;
    }
    if (generationMode === "freesound" && !freesoundApiKey.trim()) {
      toast.error("Freesound is selected, but no API key is set — add one in Preferences, or switch generation source.");
      return;
    }

    setGenerating(true);

    const addTrack = (source: string, subtitle: string, tags: string[] = ["generated", "original", "your prompt"]) => {
      const next: Sound = { id: `generated-${Date.now()}`, title: text.replace(/^./, (c) => c.toUpperCase()), subtitle, tags, color: "from-lime-400/60 to-emerald-950/80", duration: "0:20 loop", source };
      setGeneratedSounds((prev) => [next, ...prev]);
      setActive(next);
      setPlaying(true);
    };

    const fallbackToOffline = (label: string, err: unknown) => {
      const message = err instanceof SoundApiError ? err.message : `The ${label} request failed.`;
      toast.error(`${label} generation failed — used the offline generator instead. (${message})`);
      return generateAmbientTrack(text).then((url) => addTrack(url, "Generated texture · instrumental · original"));
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
      task = generateAmbientTrack(text).then((url) => addTrack(url, "Generated texture · instrumental · original"));
    }

    task
      .catch(() => toast.error("Sound generation failed."))
      .finally(() => {
        setGenerating(false);
        setPrompt("");
      });
  };

  // What the Prompt studio badge/description actually says depends on where the audio is
  // really coming from — this used to just always claim "original by design" even when the
  // source was a real third-party recording or another company's AI service, which wasn't true.
  const sourceInfo =
    generationMode === "freesound"
      ? { badge: "CC0 recordings, not original", description: "Describe a mood, place, or texture. Hushwave searches Freesound for a real, CC0-licensed recording matching it — not a Hushwave original, but free and safe to use." }
      : generationMode === "elevenlabs"
      ? { badge: "AI-generated by ElevenLabs", description: "Describe a mood, place, or texture. Hushwave asks your ElevenLabs account to generate audio matching it — this is ElevenLabs' output, not an original Hushwave recording." }
      : { badge: "original · generated on-device", description: "Describe a mood, place, or texture. Hushwave synthesizes a fresh, original ambient layer right here on your device — nothing downloaded, nothing borrowed." };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-[#f3f0e8] selection:bg-violet-400/30">
      <audio ref={audioRef} onEnded={handleEnded} onError={(e) => reportAudioError(e.currentTarget, active.title)} />
      {mixSlots.map((_, i) => (
        <audio key={i} ref={(el) => { mixAudioRefs.current[i] = el; }} onError={(e) => reportAudioError(e.currentTarget, "a Quick mix layer")} />
      ))}
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:radial-gradient(#fff_0.6px,transparent_0.6px)] [background-size:18px_18px]" />
      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/10 px-6 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400 text-[#17131f]"><Waves size={20} strokeWidth={2.5} /></div><div><div className="font-display text-lg font-semibold tracking-tight">Hushwave</div><div className="text-[10px] uppercase tracking-[0.28em] text-white/40">ambient player · v{APP_VERSION}</div></div></div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200 md:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_#86efac]" />Built-in library: original, DMCA-safe</div>
        <button onClick={() => setPrefsOpen(true)} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-white/60 transition hover:border-white/25 hover:text-white"><Settings2 size={14} /> Preferences</button>
      </header>

      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="border-white/10 bg-[#12141b] text-[#f3f0e8]">
          <DialogHeader>
            <DialogTitle>Preferences</DialogTitle>
            <DialogDescription className="text-white/45">
              These are your defaults — they're saved on this device and applied right away.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/55"><span>Default volume</span><span>{volume}%</span></div>
              <input aria-label="Default volume" type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 w-full accent-violet-300" />
            </div>
            <div>
              <div className="mb-2 text-xs text-white/55">Default loop mode</div>
              <Select value={loopMode} onValueChange={(v) => setLoopMode(v as "track" | "playlist" | "off")}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="track">Loop track</SelectItem>
                  <SelectItem value="playlist">Loop playlist</SelectItem>
                  <SelectItem value="off">Loop off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 text-xs text-white/55">Sound generation</div>
              <Select value={generationMode} onValueChange={(v) => setGenerationMode(v as "offline" | "freesound" | "elevenlabs")}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline generator (no account needed)</SelectItem>
                  <SelectItem value="freesound">Freesound — free, real recordings (your API key)</SelectItem>
                  <SelectItem value="elevenlabs">ElevenLabs — AI-generated, paid (your API key)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/55">
                <span>Freesound API key</span>
                <a href="https://freesound.org/apiv2/apply/" target="_blank" rel="noreferrer" className="text-violet-200 hover:text-white">Get a free key ↗</a>
              </div>
              <input
                type="password"
                value={freesoundApiKey}
                onChange={(e) => setFreesoundApiKey(e.target.value)}
                placeholder="Only needed if 'Freesound' is selected above"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60"
              />
              <p className="mt-2 text-[11px] leading-4 text-white/35">
                Free account, free key, no payment. Searches real Creative Commons (CC0-only) recordings matching your prompt — not synthesized, and not from ElevenLabs.
              </p>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/55">
                <span>ElevenLabs API key</span>
                <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" className="text-violet-200 hover:text-white">Get a key ↗</a>
              </div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Only needed if 'ElevenLabs' is selected above"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60"
              />
              <p className="mt-2 text-[11px] leading-4 text-white/35">
                Stored only on this device. Calls to ElevenLabs use your own account and may incur cost on their end. If an online request fails, Hushwave falls back to the offline generator automatically.
              </p>
            </div>
            <div>
              <div className="mb-2 text-xs text-white/55">Audio output device</div>
              <Select value={outputDeviceId || "__default__"} onValueChange={(v) => setOutputDeviceId(v === "__default__" ? "" : v)}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">System default</SelectItem>
                  {outputDevices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 8)}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {deviceDiagnostic ? (
                <p className="mt-2 text-[11px] leading-4 text-amber-300/80">{deviceDiagnostic}</p>
              ) : (
                <p className="mt-2 text-[11px] leading-4 text-white/35">
                  Route Hushwave's audio to a specific device — e.g. a virtual audio cable (like VB-Audio Virtual Cable, free) that OBS can capture directly via a plain Audio Output Capture source, instead of relying on OBS finding the right process.
                </p>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs text-white/55">Default sleep timer</div>
              <Select value={sleep} onValueChange={setSleep}>
                <SelectTrigger className="w-full border-white/10 bg-black/20 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Off">Off</SelectItem>
                  <SelectItem value="30 min">30 min</SelectItem>
                  <SelectItem value="60 min">60 min</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {generatedSounds.length > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs text-white/55">Clear your generated sound{generatedSounds.length > 1 ? "s" : ""} ({generatedSounds.length})</span>
                <button onClick={clearGenerated} className="text-xs text-violet-200 hover:text-white">Clear</button>
              </div>
            )}
            {customSounds.length > 0 && (
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs text-white/55">Clear your added file{customSounds.length > 1 ? "s" : ""} ({customSounds.length})</span>
                <button onClick={clearCustomFiles} className="text-xs text-violet-200 hover:text-white">Clear</button>
              </div>
            )}
            {hiddenBuiltInIds.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-white/55">Hidden library sounds ({hiddenBuiltInIds.length})</span>
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
          <DialogFooter>
            <button onClick={() => setPrefsOpen(false)} className="rounded-xl bg-violet-300 px-4 py-2 text-sm font-semibold text-[#17131f] hover:bg-violet-200">Done</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <main className="relative z-10 mx-auto grid max-w-[1440px] gap-8 px-6 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:px-10 lg:py-12">
        <section>
          <div className="mb-8 max-w-2xl"><div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.25em] text-violet-300"><Sparkles size={14} /> Sound, made quiet</div><h1 className="font-display text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-white sm:text-7xl">Find your<br /><span className="text-white/45">background.</span></h1><p className="mt-5 max-w-lg text-sm leading-6 text-white/55">Original ambient textures for focus, rest, and everything in between. Stream safely, search freely, and make a soundscape from a sentence.</p></div>
          <div className="mb-8 flex max-w-xl items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3 shadow-2xl shadow-black/20 focus-within:border-violet-300/60 focus-within:bg-white/[0.07]"><Search size={18} className="text-white/35" /><input aria-label="Search ambient sounds" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search rain, focus, ocean, cozy…" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/30" />{query && <button onClick={() => setQuery("")} aria-label="Clear search"><X size={16} className="text-white/35 hover:text-white" /></button>}<kbd className="hidden rounded-md border border-white/10 px-2 py-1 text-[10px] text-white/30 sm:block">⌘ K</kbd></div>

          <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl font-medium">Sound library <span className="ml-2 text-sm font-normal text-white/30">{filtered.length}</span></h2><div className="flex items-center gap-3"><button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1 text-xs text-white/40 hover:text-white"><Plus size={13} /> Add your own files</button><button className="flex items-center gap-1 text-xs text-white/40 hover:text-white">Newest <ChevronDown size={13} /></button></div></div>
          <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={(e) => handleFilesPicked(e.target.files)} className="hidden" />
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((sound) => <div key={sound.id} role="button" tabIndex={0} onClick={() => selectSound(sound)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSound(sound); } }} className={`group relative flex cursor-pointer items-center gap-4 rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-white/25 ${active.id === sound.id ? "border-violet-300/70 bg-violet-300/[0.08]" : "border-white/10 bg-white/[0.035]"}`}><div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${sound.color} shadow-inner`}><AudioLines size={22} className="text-white/80" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-white/90">{sound.title}</div><div className="mt-1 truncate text-xs text-white/40">{sound.subtitle}</div><div className="mt-2 flex gap-1.5">{sound.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/40">{tag}</span>)}</div></div><div className="flex flex-col items-end gap-2 text-white/30"><span className="text-[10px]">{sound.duration}</span><span className={`grid h-7 w-7 place-items-center rounded-full transition ${active.id === sound.id ? "bg-violet-300 text-[#17131f]" : "bg-white/10 group-hover:bg-white/20"}`}>{active.id === sound.id && playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</span></div><button onClick={(e) => { e.stopPropagation(); removeSound(sound); }} aria-label={`Remove ${sound.title} from library`} className="absolute right-2 top-2 hidden h-6 w-6 place-items-center rounded-full bg-black/50 text-white/60 transition hover:bg-red-500/80 hover:text-white group-hover:grid"><X size={12} /></button></div>)}
          </div>
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 py-12 text-center text-sm text-white/40">No sounds match “{query}”. Try “rain”, “focus”, or “sleep”.</div>}

          <div className="mt-10 overflow-hidden rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-400/[0.14] via-white/[0.03] to-emerald-300/[0.06] p-6"><div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-violet-200"><Sparkles size={14} /> Prompt studio</div><h2 className="font-display text-2xl">Make a soundscape</h2><p className="mt-2 max-w-md text-xs leading-5 text-white/45">{sourceInfo.description}</p></div><div className="hidden rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-3 py-2 text-[10px] text-emerald-200 sm:block"><Check size={13} className="mr-1 inline" /> {sourceInfo.badge}</div></div><div className="mt-5 flex flex-col gap-3 sm:flex-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} placeholder="e.g. moonlit greenhouse with soft rain" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60" /><button onClick={generate} disabled={generating || !prompt.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 py-3 text-sm font-semibold text-[#17131f] transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">{generating ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <><Sparkles size={15} /> Generate</>}</button></div><div className="mt-3 flex flex-wrap gap-2">{prompts.map((item) => <button key={item} onClick={() => setPrompt(item)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/45 hover:border-white/25 hover:text-white/75">{item}</button>)}</div>{generatedSounds[0] && <div className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><Check size={14} /> Added “{generatedSounds[0].title}” to your library</div>}</div>
        </section>

        <aside className="lg:pt-16"><div className="sticky top-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#12141b]/90 shadow-2xl shadow-black/40 backdrop-blur-xl"><div className={`relative flex h-56 items-end bg-gradient-to-br ${active.color} p-6`}><div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_20%,white_0,transparent_32%),linear-gradient(120deg,transparent,rgba(255,255,255,.12))]" /><div className="relative"><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/60"><Disc3 size={13} /> now playing</div><h2 className="font-display text-3xl font-medium tracking-tight">{active.title}</h2><p className="mt-1 text-xs text-white/55">{active.subtitle}</p></div><div className="absolute right-6 top-6 grid h-12 w-12 place-items-center rounded-2xl border border-white/20 bg-black/10 text-white/70"><Headphones size={20} /></div></div><div className="p-6"><div className="mb-2 flex items-center justify-between text-[10px] text-white/30"><span>00:42</span><span>{active.duration === "∞" ? "∞" : active.duration}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[34%] rounded-full bg-violet-300" /></div><div className="mt-6 flex items-center justify-center gap-5"><button onClick={() => step(-1)} className="text-white/40 hover:text-white" aria-label="Previous track"><SkipBack size={18} /></button><button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#17131f] shadow-xl shadow-white/10 transition hover:scale-105">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}</button><button onClick={() => step(1)} className="text-white/40 hover:text-white" aria-label="Next track"><SkipForward size={19} /></button></div><div className="mt-7 grid grid-cols-2 gap-2"><button onClick={() => setLoopMode(loopMode === "track" ? "playlist" : loopMode === "playlist" ? "off" : "track")} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${loopMode !== "off" ? "border-violet-300/40 bg-violet-300/10 text-violet-200" : "border-white/10 text-white/45"}`}><Repeat size={14} /> {loopMode === "track" ? "Loop track" : loopMode === "playlist" ? "Loop playlist" : "Loop off"}</button><button onClick={() => setSleep(sleep === "Off" ? "30 min" : sleep === "30 min" ? "60 min" : "Off")} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/45 transition hover:border-white/25 hover:text-white"><Clock3 size={14} /> Sleep {sleep}</button></div><div className="mt-7 flex items-center gap-3"><Volume2 size={16} className="text-white/35" /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 flex-1 accent-violet-300" /><span className="w-8 text-right text-[11px] text-white/35">{volume}%</span></div><div className="mt-7 border-t border-white/10 pt-5"><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs text-white/55"><SlidersHorizontal size={14} /> Quick mix</span><button onClick={resetMix} className="text-[11px] text-violet-200 hover:text-white">Reset</button></div><div className="space-y-3">{mixSlots.map((slot, i) => <div key={i} className="flex items-center gap-3"><select aria-label={`Quick mix slot ${i + 1}`} value={slot.soundId} onChange={(e) => setMixSlots((prev) => prev.map((s, j) => j === i ? { soundId: e.target.value, volume: e.target.value ? (s.volume || 30) : 0 } : s))} className="w-28 shrink-0 truncate rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[11px] text-white/70 outline-none focus:border-violet-300/60"><option value="">None</option>{allSounds.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select><input aria-label={`Quick mix slot ${i + 1} volume`} type="range" min="0" max="100" value={slot.volume} disabled={!slot.soundId} onChange={(e) => setMixSlots((prev) => prev.map((s, j) => j === i ? { ...s, volume: Number(e.target.value) } : s))} className="h-1 flex-1 accent-violet-300 disabled:opacity-30" /><span className="w-7 text-right text-[10px] text-white/30">{slot.volume}</span></div>)}</div></div></div></div></aside>
      </main>
      <footer className="relative z-10 mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-white/10 px-6 py-6 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between lg:px-10"><div>Hushwave's built-in library is original and DMCA-safe. Optional online sources (Freesound, ElevenLabs) bring in content licensed by you, not Hushwave.</div><div className="flex items-center gap-4"><span className="flex items-center gap-1.5"><Check size={12} className="text-emerald-300" /> built-in tracks: no copyright</span><span className="flex items-center gap-1.5"><Plus size={12} /> Windows-ready</span></div></footer>
    </div>
  );
}

