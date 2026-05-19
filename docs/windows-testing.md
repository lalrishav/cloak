# Windows Test Plan

Use this checklist before giving Cloak to Windows users. The first goal is not a public release; it is proving the overlay, shortcuts, voice pacing, and installer on real Windows machines.

## Build a Test Artifact

Preferred path: GitHub Actions on a real Windows runner.

1. Push the branch to GitHub.
2. Open **Actions -> Windows Test Build**.
3. Click **Run workflow**.
4. Download the `cloak-windows-test-<sha>` artifact.
5. Test both generated files:
   - `Cloak-<version>-win-x64-setup.exe` from the NSIS installer target.
   - `Cloak-<version>-win-x64-portable.exe`, which can run without installation.

Local Windows path:

```powershell
cd cue
npm ci
npm run test -w @cloak/desktop
npm run dist:win -w @cloak/desktop
```

The generated files land in:

```text
apps/desktop/dist/
```

Unsigned test builds are expected to trigger Windows SmartScreen. That is acceptable for internal testing only. Public release builds need code signing.

## Minimum Windows Version

Test on:

- Windows 11, current stable release.
- Windows 10 version 2004 or newer.

Cloak depends on Electron's `BrowserWindow.setContentProtection(true)`, which maps to Windows `SetWindowDisplayAffinity(..., WDA_EXCLUDEFROMCAPTURE)`. On Windows 10 versions older than 2004, Windows may show a black window in captures instead of fully excluding the overlay.

## Functional Smoke Test

1. Launch Cloak.
2. Paste a script into the control window.
3. Toggle the overlay on.
4. Confirm the overlay is visible on the physical display.
5. Press `Ctrl+Shift+Space` to play/pause.
6. Press `Ctrl+Shift+Up` and `Ctrl+Shift+Down` to change speed.
7. Press `Ctrl+Alt+Up` and `Ctrl+Alt+Down` to manually nudge the overlay.
8. Drag and resize the overlay.
9. Restart the app and confirm script/settings restore.
10. Connect the phone remote from another device on the same Wi-Fi.

## Capture-Protection Matrix

For each app below, start capture while the overlay is visible on the physical display. The capture preview or recording should not contain the overlay.

| Capture app | Mode | Expected result |
|---|---|---|
| OBS | Display Capture | Overlay missing |
| OBS | Window Capture of another app | Overlay missing |
| Zoom | Share entire screen | Overlay missing |
| Microsoft Teams | Share entire screen | Overlay missing |
| Google Meet | Browser screen share | Overlay missing |
| Loom | Screen recording | Overlay missing |
| Snipping Tool | Screenshot / video | Overlay missing or black on unsupported builds |
| Print Screen | Screenshot | Overlay missing or black on unsupported builds |

Also test:

- One monitor.
- Two monitors, overlay on each display.
- 100%, 125%, 150%, and 200% display scaling.
- A fullscreen browser, PowerPoint, and code editor behind the overlay.

## Voice Pacing

If testing voice pacing:

1. Put this file on the Windows machine:

```text
%APPDATA%\Cloak\.env
```

2. Add:

```text
DEEPGRAM_API_KEY=your_key_here
DEEPGRAM_LANGUAGE=multi
OPENAI_API_KEY=sk-optional
```

3. Restart Cloak.
4. Start Voice Pacing and read the script naturally.
5. Confirm the highlight recovers when you skip or mispronounce a few words and then resume clearly.

## Release Gate Notes

Do not mark `win32` stable in the admin release table until:

- The installer and portable build both launch.
- The capture matrix passes on at least one Windows 11 machine.
- Multi-monitor and DPI scaling pass.
- The boot/version gate allows the tested app version for `win32`.
- The public download page points to `/v1/download/win32`.

Public Windows releases also need code signing. Unsigned builds are only for internal testing.
