# Cloak — Capture-Aware Teleprompter

Cloak is a desktop teleprompter overlay built with Electron. It floats above any application on your screen and scrolls your script at a configurable speed. On supported operating systems, the overlay is excluded from screen capture and screen sharing — visible on your physical display, but absent from recordings and shared screens.

The word here is **capture-aware**, not "undetectable." Cloak uses documented OS-level APIs to opt the overlay window out of capture. Those APIs work in most cases and fail in a few specific ones. See *Known limitations* below.

## How it works

Cloak's overlay window calls `BrowserWindow.setContentProtection(true)` in the Electron main process. That single call wraps two native OS APIs:

- **Windows**: `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` — the desktop compositor (DWM) omits the window from any frame it hands to capture clients. Supported on Windows 10 version 2004 and later.
- **macOS**: `NSWindowSharingNone` — the window server does not include the window in screen-sharing or recording feeds taken through the legacy `CGWindowList` / `CGDisplayStream` path.

Cloak does not use CSS tricks, video filters, or any heuristic the recording app could see through. The window is hidden at the OS compositor layer, before any pixels reach a recorder.

## Platform behavior

| Setup | Behavior |
|---|---|
| **Windows 10 2004+** (OBS, Zoom, Teams, Meet, Discord) | ✓ Invisible. The window is excluded from capture by DWM. |
| **macOS, legacy capture path** (`CGWindowList`, older versions of most apps) | ✓ Hidden. `NSWindowSharingNone` is honored. |
| **macOS, ScreenCaptureKit apps** (Zoom v5.16+, OBS v30+, macOS Screenshot.app on macOS 14+) | ⚠ May be visible. ScreenCaptureKit on recent macOS versions can ignore the sharing flag. |
| **Hardware capture cards** (HDMI capture, Elgato, etc.) | ✗ Always visible. Hardware capture reads the signal *after* the GPU has rendered the frame to the display — there is no software layer to opt out at. |
| **Phone or external camera pointed at the screen** | ✗ Always visible. Physics. |

If invisibility matters for your use case, **test with your specific recording setup** before relying on it.

## Install & run

```bash
cd cue
npm install
npm start
```

To enable the **✨ FORMAT WITH AI** button (one-shot reformatter that adds timed pauses, breaths, paragraph breaks and other cues to your script without touching any words), launch with your OpenAI key in the environment:

```bash
OPENAI_API_KEY=sk-... npm start
```

To enable **Voice Pacing** with Deepgram Speech-to-Text, set a Deepgram key too:

```bash
DEEPGRAM_API_KEY=... npm start
```

You can also put `DEEPGRAM_API_KEY=...` in a local `.env` file next to `main.js`.

For the packaged Mac app, put local keys in:

```bash
mkdir -p "$HOME/Library/Application Support/Cloak"
nano "$HOME/Library/Application Support/Cloak/.env"
```

Example:

```bash
DEEPGRAM_API_KEY=your_deepgram_api_key_here
DEEPGRAM_LANGUAGE=multi
OPENAI_API_KEY=sk-...
```

The key is read once at startup and lives only in the main process — it is never written to disk, never sent to the renderer, and never persisted by the app. If `OPENAI_API_KEY` is unset, the button is disabled with a tooltip pointing here.

## Install as a Mac app

Build a fresh `.dmg` and `.app` bundle:

```bash
cd cue
npm install
npm run build:dmg
```

Then install the built app into Applications:

```bash
npm run install:local
```

By default this removes old `Cloak.app` copies from `~/Applications` and `/Applications`, then installs the fresh build to `/Applications/Cloak.app`. To install somewhere else, run `CLOAK_INSTALL_DIR=~/Applications npm run install:local`.

After that, launch **Cloak** from Launchpad, Spotlight, or Finder like any other app. If macOS blocks the locally built app, right-click **Cloak.app**, choose **Open**, then confirm.

Two windows open:

- **Control panel** — paste your script, adjust speed/font/opacity, reposition the overlay.
- **Overlay** — the teleprompter itself, a translucent panel that floats above everything.

The control panel is a normal window and is *not* capture-protected. Share or screenshot it as you like. The overlay is the only protected surface.

## Using Cloak

1. Paste or load a `.txt` script in the control panel.
2. Hit **PLAY** (or `⌘/Ctrl+Shift+Space`) to start scrolling.
3. Adjust **SPEED**, **FONT SIZE**, and **OPACITY** on the fly.
4. Reposition the overlay by dragging the thin handle at its top, or by setting **X/Y/WIDTH/HEIGHT** in the control panel and clicking **APPLY POSITION**.
5. Press `⌘/Ctrl+Shift+R` to reset to the top.

### Keyboard shortcuts (global)

| Shortcut | Action |
|---|---|
| `⌘/Ctrl+Shift+Space` | Play / Pause |
| `⌘/Ctrl+Shift+R` | Reset to top |
| `⌘/Ctrl+Shift+↑` | Speed +1 |
| `⌘/Ctrl+Shift+↓` | Speed -1 |

Shortcuts work even when another app is focused — useful when you're on a Zoom or Meet call and Cloak is in the background.

## Architecture

Cloak runs two `BrowserWindow` instances and a main process.

- **Main process** (`main.js`) — creates both windows, registers global shortcuts, owns the IPC routing. Calls `setContentProtection(true)` on the overlay window only.
- **Overlay window** (`windows/overlay.html` + `overlay.js`) — frameless, transparent, `alwaysOnTop` at `screen-saver` level, `visibleOnFullScreen: true`. Click-through everywhere except the drag handle at the top. Scrolls text via `requestAnimationFrame`.
- **Control panel window** (`windows/control.html` + `control.js`) — standard window. Sends all user input to the main process, which forwards to the overlay.
- **Preload bridge** (`preload.js`) — exposes a narrow `window.cue` API to both renderers via `contextBridge`. `contextIsolation` is on, `nodeIntegration` is off. Renderers never see `ipcRenderer` directly.

All cross-window communication flows main → overlay; the control panel never speaks to the overlay directly. This keeps the trust boundary clean and means the overlay can ignore IPC from anywhere that isn't the main process.

The control panel persists script, speed, font, opacity, and overlay position to `localStorage` and restores them on relaunch.

## Why `setContentProtection` and not something else

A few approaches *don't* work and Cloak avoids them:

- **CSS or canvas tricks** — recording captures pixels, not DOM. There's nothing the renderer can do to hide them.
- **Window manager hacks** — modern compositors (DWM, WindowServer, Wayland) ignore old-school z-order tricks. The compositor is the one assembling the capture frame.
- **External "stealth" libraries** — most are wrappers around the same `SetWindowDisplayAffinity` / `NSWindowSharingNone` calls Electron already exposes.

`setContentProtection(true)` is the call. Electron wires it to the right native API per platform, and that's all there is.

## Known limitations

- **macOS ScreenCaptureKit**: Apple's newer capture framework can ignore `NSWindowSharingNone` for windows that opt in to sharing in specific ways. Recent Zoom, OBS, and the built-in Screenshot tool use SCK. Test before you rely on it.
- **Hardware capture devices**: HDMI/USB capture reads the post-composited signal. No software protection applies.
- **External cameras** pointed at your screen: also physics.
- **Wayland / Linux**: `setContentProtection` is a no-op on Linux. Cloak runs but the overlay is not capture-excluded.
- **Multiple displays**: The overlay starts on the primary display. Drag it where you want it.

## License

MIT.
