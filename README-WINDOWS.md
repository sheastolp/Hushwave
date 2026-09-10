# Hushwave for Windows

Hushwave is a native Windows desktop app built with **Tauri** and WebView2. It does not run in a browser tab and does not use Electron.

## Easiest way: let GitHub build the .exe for you (no installs needed)

This repo includes a GitHub Actions workflow (`.github/workflows/build-windows.yml`) that builds the Windows installer on GitHub's own Windows servers — you don't need Node, Rust, or Visual Studio on your PC at all.

1. Create a free account at github.com if you don't have one.
2. Create a new **empty** repository (no README/license) — e.g. `hushwave`.
3. Upload this project to it. Easiest way if you don't use git: on the new repo's page, click **Add file → Upload files**, then drag the entire extracted `hushwave` folder's contents in and commit.
   (If you do have git installed: `git init`, `git add .`, `git commit -m "initial"`, `git remote add origin <your repo URL>`, `git push -u origin main`.)
4. Click the **Actions** tab on your repo. A "Build Windows installer" run should already be in progress (it starts automatically on push). If not, click it and press **Run workflow**.
5. Wait for the run to finish (first run takes 10–15 minutes; it's compiling Rust from scratch).
6. Open the finished run, scroll to **Artifacts**, and download `hushwave-windows-installer` — it's a zip containing the `.exe` (NSIS) and `.msi` installers.
7. Unzip and run the installer.

## Building locally instead

If you'd rather build on your own machine, install [Node.js](https://nodejs.org) (LTS) and [Rust](https://rustup.rs) — the Rust installer will prompt you to also install the Visual C++ Build Tools, which you need. Then, from PowerShell or Command Prompt in this folder:

```powershell
npm install
npm run tauri:build
```

Installers land in `src-tauri\target\release\bundle\`.

For local development with hot reload:

```powershell
npm run tauri:dev
```

## If the app opens to a blank white window

This is almost always one of two things:

1. **WebView2 isn't installed or is broken.** Tauri on Windows renders through the Microsoft Edge WebView2 runtime. Install/repair it from https://developer.microsoft.com/microsoft-edge/webview2/ and relaunch the app.
2. **A stale build.** Delete `dist\`, `src-tauri\target\`, and `node_modules\`, then rebuild from a clean slate.

The app includes the searchable original ambient library, prompt studio UI, playback controls, track/playlist loop modes, sleep timer, volume, and quick mix controls.
