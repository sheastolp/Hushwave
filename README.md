# Hushwave

**An ambient sound player for Windows.** Play calm background sounds for focus, sleep, reading, or streaming — and make brand-new soundscapes just by describing them.

Hushwave is a native Windows desktop app (built with [Tauri](https://tauri.app) and Microsoft WebView2). It is small, works offline, and its built-in sounds are original, so they're safe to use on stream without copyright (DMCA) claims.

---

## Contents

- [What it does](#what-it-does)
- [Setup guide](#setup-guide)
  - [1. Get the installer](#1-get-the-installer)
  - [2. Install it](#2-install-it)
  - [3. First run](#3-first-run)
  - [4. Optional: online sound sources](#4-optional-online-sound-sources)
  - [5. Optional: streaming with OBS](#5-optional-streaming-with-obs)
- [Using Hushwave](#using-hushwave)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Building from source](#building-from-source)
- [Privacy](#privacy)

---

## What it does

- **Built-in library** — rain, brown noise, a fireplace cabin, ocean tide, library room tone, and a warm ambient pad. All original recordings made for Hushwave.
- **Prompt studio** — type a description like *"rain on a tent with distant thunder"* and Hushwave creates a new, seamless looping soundscape on your computer. No account, no internet needed.
  - Layers up to five sounds at once: rain, thunder, wind, fireplace, ocean waves, stream, crickets, birdsong, city traffic, café murmur, train rhythm, low hum, deep drone, soft chimes, warm pad, and white / pink / brown noise.
  - Understands mood words: *gentle* / *heavy*, *dark* / *bright*, *small room* / *cathedral*, *muffled* / *underwater*.
  - Shows a live preview of what it will make before you press **Generate**. Pressing it again gives a new variation.
- **Quick mix** — layer up to three extra sounds under the main one, each with its own volume.
- **Add your own files** — drag MP3, WAV, OGG, FLAC, or M4A files onto the window.
- **Sleep timer** — stop playback after 15, 30, 60, or 90 minutes, with a live countdown.
- **Repeat modes** — repeat one sound, play through the whole library, or stop at the end.
- **Audio output picker** — send Hushwave to a specific device, such as a virtual cable for OBS.
- **Keyboard and media keys** — Space, arrow keys, and your keyboard/headset media buttons all work.

---

## Setup guide

### 1. Get the installer

Hushwave is built automatically by GitHub every time the code changes, so you don't need to install any developer tools.

1. Open this repository on GitHub and click the **Actions** tab.
2. Click the most recent **Build Windows installer** run with a green check mark ✅.
   *(The first build takes 10–15 minutes. Later builds are faster.)*
3. Scroll to the bottom of the run page to **Artifacts** and click **hushwave-windows-installer** to download it.
   *(You must be signed in to GitHub to download artifacts.)*
4. Unzip the downloaded file. Inside are two installers — you only need one:
   - **`Hushwave_x.y.z_x64-setup.exe`** — recommended for most people.
   - **`Hushwave_x.y.z_x64_en-US.msi`** — for managed/business PCs that prefer MSI.

> **Tip:** The version number shown in the top-left of the app (e.g. `v1.0.13`) tells you which build you're running.

### 2. Install it

1. Double-click the **`-setup.exe`** file.
2. If Windows shows **"Windows protected your PC"**, click **More info → Run anyway**. This appears because the app isn't signed with a paid code-signing certificate; it's expected for small open-source apps.
3. Follow the installer. Hushwave appears in your Start menu when it finishes.

**Updating:** download the newest installer the same way and run it — it installs over the old version and keeps your settings.

**Requirement:** Windows 10 or 11 with the Microsoft **WebView2 Runtime**. It's already included in Windows 11 and in up-to-date Windows 10. If the app opens to a blank white window, see [Troubleshooting](#troubleshooting).

### 3. First run

1. Open **Hushwave** from the Start menu.
2. Click any sound in the **Sound library** to start it. Click it again to pause.
3. Open **Preferences** (top-right) and press **Play test sound** under *Audio output*. You should hear a short two-note chime. If you don't, see [No sound](#no-sound).
4. Optionally set your default volume, repeat mode, and sleep timer in Preferences. Settings are saved automatically.

That's it — everything else is optional.

### 4. Optional: online sound sources

The Prompt studio works fully offline by default. If you'd like it to fetch real recordings or AI-generated audio instead, you can connect one of these with your own free or paid key. Your key is stored only on your computer.

| Source | Cost | What you get |
|---|---|---|
| **Offline generator** (default) | Free | Original sounds synthesized on your PC |
| **Freesound** | Free | Real recordings, CC0-licensed (public domain) only |
| **ElevenLabs** | Paid (your account) | AI-generated sound effects |

**Freesound (free):**
1. Create a free account at [freesound.org](https://freesound.org).
2. Go to [freesound.org/apiv2/apply](https://freesound.org/apiv2/apply/) and create a new API credential (any name and description is fine).
3. Copy the **Client secret / API key**.
4. In Hushwave: **Preferences → Prompt studio source → Freesound**, then paste the key.

**ElevenLabs (paid):**
1. Sign in at [elevenlabs.io](https://elevenlabs.io) and open [Settings → API keys](https://elevenlabs.io/app/settings/api-keys).
2. Create a key and copy it.
3. In Hushwave: **Preferences → Prompt studio source → ElevenLabs**, then paste the key.

If an online request fails for any reason, Hushwave automatically falls back to the offline generator so you still get a sound.

### 5. Optional: streaming with OBS

The simplest way to capture Hushwave in OBS reliably is to give it its own audio device:

1. Install the free **[VB-Audio Virtual Cable](https://vb-audio.com/Cable/)** and restart your PC.
2. In Hushwave: **Preferences → Audio output**. If the list only shows generic names, click **Show all devices by name** (Windows asks for microphone permission once just to reveal device names — Hushwave never records anything). Choose **CABLE Input (VB-Audio Virtual Cable)**.
3. In OBS: add a source → **Audio Input Capture** → choose **CABLE Output (VB-Audio Virtual Cable)**.
4. To hear it yourself too: in Windows **Sound settings → More sound settings → Recording → CABLE Output → Properties → Listen**, tick **Listen to this device** and pick your headphones.

While sound is routed away from your default speakers, the player shows a yellow notice with a **Use default** button so you never lose track of where it's going.

---

## Using Hushwave

**Prompt studio tips**
- Mention every sound you want: *"crackling fireplace with heavy rain and distant thunder"*.
- Add mood words to shape it: *gentle*, *heavy*, *dark*, *bright*, *cozy cabin*, *vast cathedral*, *underwater*.
- Watch the **Will layer:** line under the text box to see what Hushwave understood.
- Press **New variation** to get a different take on the same prompt.
- Choose 30-second, 1-minute, or 2-minute loops in **Preferences → Length of on-device sounds**. All loops are seamless.

**Library**
- Click a tag (like *rain* or *sleep*) to filter by it, or search at the top.
- Hover a sound and click **×** to hide it. An **Undo** button appears; hidden built-in sounds can be restored in Preferences.
- Generated sounds and files you add last until you close the app.

**Quick mix**
- Pick up to three extra layers in the player panel and set each one's volume. They play and pause together with the main sound.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` | Previous / next sound |
| `M` | Mute / unmute |
| `Ctrl` + `K` or `/` | Jump to search |
| `Esc` (in search) | Clear search |

Keyboard media keys, headset buttons, and the Windows media overlay also work.

---

## Troubleshooting

### No sound
1. In **Preferences → Audio output**, press **Play test sound**. The message tells you which device it played through.
2. If the player shows a yellow **"Sound is going to…"** notice, click **Use default** to switch back to your normal speakers.
3. Right-click the speaker icon in the Windows taskbar → **Volume mixer** and make sure **Hushwave** isn't muted or turned all the way down.
4. Check the volume slider and mute button (speaker icon) in the player.
5. If you use a virtual cable for OBS, remember that sound sent there won't reach your speakers unless you enable **Listen to this device** (see [step 5](#5-optional-streaming-with-obs)).

### The window is blank / white
1. Install or repair the **Microsoft Edge WebView2 Runtime** from [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/) and reopen Hushwave.
2. Still blank? Uninstall Hushwave, then install the latest build again.

### "Windows protected your PC"
Click **More info → Run anyway**. See [Install it](#2-install-it).

### Freesound or ElevenLabs says the key is missing or invalid
Re-copy the key into **Preferences → Prompt studio source**, making sure there are no extra spaces. Or switch back to **Offline generator**, which needs no key.

### The audio device list is empty
Click **Show all devices by name** in Preferences. If it's still empty, update Windows and WebView2 — the list comes from Windows itself. **System default** always works regardless.

---

## Building from source

You only need this if you want to change the code. For more detail, see [README-WINDOWS.md](README-WINDOWS.md).

**Requirements**
- [Node.js](https://nodejs.org) (LTS, v20 or newer)
- [Rust](https://rustup.rs) — on Windows the installer will also prompt for the Visual C++ Build Tools, which are required.

**Commands** (run in the project folder):

```powershell
npm install          # install dependencies
npm run tauri:dev    # run the desktop app with live reload
npm run tauri:build  # build the installers
npm run check        # TypeScript type check
```

Installers are written to `src-tauri\target\release\bundle\`.

**Project layout**

| Path | What's there |
|---|---|
| `client/src/pages/Home.tsx` | The main app screen (library, player, Preferences, Prompt studio) |
| `client/src/lib/ambientEngine.ts` | The on-device sound generator |
| `client/src/lib/generateAmbient.ts` | Freesound and ElevenLabs integrations |
| `client/public/audio/` | Built-in library sounds |
| `src-tauri/` | Native Windows shell (Rust) and app config |
| `.github/workflows/build-windows.yml` | Automatic installer builds on GitHub |

**Releasing a new version:** update the version number in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `APP_VERSION` in `client/src/pages/Home.tsx`, then push. GitHub Actions builds the new installer.

---

## Privacy

- Hushwave has no accounts, ads, or tracking, and sends no data anywhere by default.
- Settings and API keys are stored only on your computer.
- The internet is used only if **you** choose Freesound or ElevenLabs, and then only to send your prompt to that service using your own key.
- Microphone permission is requested only if you click **Show all devices by name**, and only so Windows will reveal device names. Nothing is ever recorded.
