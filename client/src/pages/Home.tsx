import { useEffect, useMemo, useRef, useState } from "react";
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
  Layers3,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings2,
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

const prompts = ["rain on a skylight", "late-night train cabin", "warm analog room tone"];

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
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<Sound | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Keep the <audio> element's src in sync with whichever track is "active," even if it
  // became active without going through selectSound (e.g. the initial default track).
  useEffect(() => {
    if (audioRef.current && active.source && audioRef.current.src !== new URL(active.source, window.location.href).href) {
      audioRef.current.src = active.source;
    }
  }, [active]);

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

  // Sleep timer: stop playback after the chosen duration.
  useEffect(() => {
    if (sleep === "Off") return;
    const minutes = sleep === "30 min" ? 30 : 60;
    const timer = window.setTimeout(() => {
      audioRef.current?.pause();
      setPlaying(false);
    }, minutes * 60 * 1000);
    return () => window.clearTimeout(timer);
  }, [sleep, active]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return sounds;
    return sounds.filter((sound) => [sound.title, sound.subtitle, ...sound.tags].join(" ").toLowerCase().includes(q));
  }, [query]);

  const selectSound = (sound: Sound) => {
    setActive(sound);
    setPlaying(true);
    if (sound.source && audioRef.current) {
      audioRef.current.src = sound.source;
      audioRef.current.play().catch(() => setPlaying(false));
    }
  };

  const togglePlay = () => {
    if (active.source && audioRef.current) {
      if (playing) audioRef.current.pause();
      else audioRef.current.play().catch(() => undefined);
    }
    setPlaying((value) => !value);
  };

  const step = (direction: 1 | -1) => {
    const list = filtered.length ? filtered : sounds;
    const currentIndex = list.findIndex((s) => s.id === active.id);
    const nextIndex = (currentIndex + direction + list.length) % list.length;
    selectSound(list[nextIndex]);
  };

  const handleEnded = () => {
    if (loopMode === "playlist") {
      step(1);
    } else {
      setPlaying(false);
    }
  };

  const clearGenerated = () => {
    if (generated && active.id === generated.id) setActive(sounds[0]);
    setGenerated(null);
  };

  const generate = () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    window.setTimeout(() => {
      const next: Sound = { id: `generated-${Date.now()}`, title: prompt.trim().replace(/^./, (c) => c.toUpperCase()), subtitle: "Generated texture · instrumental · original", tags: ["generated", "original", "your prompt"], color: "from-lime-400/60 to-emerald-950/80", duration: "02:40", source: sounds[0].source };
      setGenerated(next); setActive(next); setPlaying(true); setGenerating(false); setPrompt("");
    }, 1400);
  };

  return (
    <div className="min-h-screen bg-[#0b0c10] text-[#f3f0e8] selection:bg-violet-400/30">
      <audio ref={audioRef} loop={loopMode === "track"} onEnded={handleEnded} />
      <div className="pointer-events-none fixed inset-0 opacity-30 [background-image:radial-gradient(#fff_0.6px,transparent_0.6px)] [background-size:18px_18px]" />
      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/10 px-6 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-violet-400 text-[#17131f]"><Waves size={20} strokeWidth={2.5} /></div><div><div className="font-display text-lg font-semibold tracking-tight">Hushwave</div><div className="text-[10px] uppercase tracking-[0.28em] text-white/40">ambient player</div></div></div>
        <div className="hidden items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-200 md:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_#86efac]" />DMCA-safe library</div>
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
            {generated && (
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <span className="text-xs text-white/55">Clear your generated sound</span>
                <button onClick={clearGenerated} className="text-xs text-violet-200 hover:text-white">Clear</button>
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

          <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-xl font-medium">Sound library <span className="ml-2 text-sm font-normal text-white/30">{filtered.length}</span></h2><button className="flex items-center gap-1 text-xs text-white/40 hover:text-white">Newest <ChevronDown size={13} /></button></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((sound) => <button key={sound.id} onClick={() => selectSound(sound)} className={`group flex items-center gap-4 rounded-2xl border p-3 text-left transition duration-200 hover:-translate-y-0.5 hover:border-white/25 ${active.id === sound.id ? "border-violet-300/70 bg-violet-300/[0.08]" : "border-white/10 bg-white/[0.035]"}`}><div className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${sound.color} shadow-inner`}><AudioLines size={22} className="text-white/80" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-white/90">{sound.title}</div><div className="mt-1 truncate text-xs text-white/40">{sound.subtitle}</div><div className="mt-2 flex gap-1.5">{sound.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] text-white/40">{tag}</span>)}</div></div><div className="flex flex-col items-end gap-2 text-white/30"><span className="text-[10px]">{sound.duration}</span><span className={`grid h-7 w-7 place-items-center rounded-full transition ${active.id === sound.id ? "bg-violet-300 text-[#17131f]" : "bg-white/10 group-hover:bg-white/20"}`}>{active.id === sound.id && playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}</span></div></button>)}
          </div>
          {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-white/15 py-12 text-center text-sm text-white/40">No sounds match “{query}”. Try “rain”, “focus”, or “sleep”.</div>}

          <div className="mt-10 overflow-hidden rounded-3xl border border-violet-300/20 bg-gradient-to-br from-violet-400/[0.14] via-white/[0.03] to-emerald-300/[0.06] p-6"><div className="flex items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-violet-200"><Sparkles size={14} /> Prompt studio</div><h2 className="font-display text-2xl">Make a soundscape</h2><p className="mt-2 max-w-md text-xs leading-5 text-white/45">Describe a mood, place, or texture. Hushwave creates a fresh original ambient layer for your session.</p></div><div className="hidden rounded-xl border border-emerald-200/20 bg-emerald-200/10 px-3 py-2 text-[10px] text-emerald-200 sm:block"><Check size={13} className="mr-1 inline" /> original by design</div></div><div className="mt-5 flex flex-col gap-3 sm:flex-row"><input value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate()} placeholder="e.g. moonlit greenhouse with soft rain" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-violet-300/60" /><button onClick={generate} disabled={generating || !prompt.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-violet-300 px-5 py-3 text-sm font-semibold text-[#17131f] transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-50">{generating ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : <><Sparkles size={15} /> Generate</>}</button></div><div className="mt-3 flex flex-wrap gap-2">{prompts.map((item) => <button key={item} onClick={() => setPrompt(item)} className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/45 hover:border-white/25 hover:text-white/75">{item}</button>)}</div>{generated && <div className="mt-4 flex items-center gap-2 text-xs text-emerald-200"><Check size={14} /> Added “{generated.title}” to your library</div>}</div>
        </section>

        <aside className="lg:pt-16"><div className="sticky top-8 overflow-hidden rounded-[28px] border border-white/10 bg-[#12141b]/90 shadow-2xl shadow-black/40 backdrop-blur-xl"><div className={`relative flex h-56 items-end bg-gradient-to-br ${active.color} p-6`}><div className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_20%_20%,white_0,transparent_32%),linear-gradient(120deg,transparent,rgba(255,255,255,.12))]" /><div className="relative"><div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.25em] text-white/60"><Disc3 size={13} /> now playing</div><h2 className="font-display text-3xl font-medium tracking-tight">{active.title}</h2><p className="mt-1 text-xs text-white/55">{active.subtitle}</p></div><div className="absolute right-6 top-6 grid h-12 w-12 place-items-center rounded-2xl border border-white/20 bg-black/10 text-white/70"><Headphones size={20} /></div></div><div className="p-6"><div className="mb-2 flex items-center justify-between text-[10px] text-white/30"><span>00:42</span><span>{active.duration === "∞" ? "∞" : active.duration}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[34%] rounded-full bg-violet-300" /></div><div className="mt-6 flex items-center justify-center gap-5"><button onClick={() => step(-1)} className="text-white/40 hover:text-white" aria-label="Previous"><Layers3 size={18} /></button><button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#17131f] shadow-xl shadow-white/10 transition hover:scale-105">{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="ml-0.5" />}</button><button onClick={() => step(1)} className="text-white/40 hover:text-white" aria-label="Next"><ListMusic size={19} /></button></div><div className="mt-7 grid grid-cols-2 gap-2"><button onClick={() => setLoopMode(loopMode === "track" ? "playlist" : loopMode === "playlist" ? "off" : "track")} className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs transition ${loopMode !== "off" ? "border-violet-300/40 bg-violet-300/10 text-violet-200" : "border-white/10 text-white/45"}`}><Repeat size={14} /> {loopMode === "track" ? "Loop track" : loopMode === "playlist" ? "Loop playlist" : "Loop off"}</button><button onClick={() => setSleep(sleep === "Off" ? "30 min" : sleep === "30 min" ? "60 min" : "Off")} className="flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-xs text-white/45 transition hover:border-white/25 hover:text-white"><Clock3 size={14} /> Sleep {sleep}</button></div><div className="mt-7 flex items-center gap-3"><Volume2 size={16} className="text-white/35" /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="h-1 flex-1 accent-violet-300" /><span className="w-8 text-right text-[11px] text-white/35">{volume}%</span></div><div className="mt-7 border-t border-white/10 pt-5"><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs text-white/55"><SlidersHorizontal size={14} /> Quick mix</span><button className="text-[11px] text-violet-200 hover:text-white">Reset</button></div><div className="space-y-3"><MixRow name="Room tone" value={38} color="bg-cyan-300" /><MixRow name="Soft rain" value={22} color="bg-violet-300" /><MixRow name="Low hum" value={16} color="bg-amber-200" /></div></div></div></div></aside>
      </main>
      <footer className="relative z-10 mx-auto flex max-w-[1440px] flex-col gap-3 border-t border-white/10 px-6 py-6 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between lg:px-10"><div>Hushwave is a calm space for original, DMCA-safe ambient audio.</div><div className="flex items-center gap-4"><span className="flex items-center gap-1.5"><Check size={12} className="text-emerald-300" /> no copyrighted tracks</span><span className="flex items-center gap-1.5"><Plus size={12} /> Windows-ready</span></div></footer>
    </div>
  );
}

function MixRow({ name, value, color }: { name: string; value: number; color: string }) {
  return <div className="flex items-center gap-3"><span className="w-20 text-[11px] text-white/40">{name}</span><div className="h-1 flex-1 rounded-full bg-white/10"><div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} /></div><span className="w-7 text-right text-[10px] text-white/30">{value}</span></div>;
}

