---
name: Authenticated screenshot capture
description: How to capture logged-in app screenshots on this Repl (working recipe + pitfalls)
---

Testing-browser evidence images are not workspace files; use local Chromium + CDP for bulk authenticated captures. Working recipe lives in scripts/capture-system-guide.mjs (resumable via FRESH_AFTER mtime check).

**Working setup:** the container has an X server on DISPLAY :0 — run nix-store Chromium *headed* (`DISPLAY=:0`, no --headless) with --no-sandbox --disable-gpu --disable-dev-shm-usage, remote debugging port, and it captures reliably. Start Chromium as its own background task, separate from the capture script.

**Pitfalls (each cost hours):**
- `--headless=new` capture (Page.captureScreenshot AND screencast) can hang forever environment-wide, even on about:blank — after a container restart it stopped working entirely. Headed + X display fixed it.
- `--run-all-compositor-stages-before-draw` (without virtual time budget) makes captureScreenshot hang. Don't add it.
- In headed mode the window manager shrinks the window → responsive apps render mobile layout and login-field indexes shift. Always `Emulation.setDeviceMetricsOverride` (fine in headed mode; it broke capture in headless) and select login inputs by placeholder, not index.
- Capture through the shared proxy (port 80) with the artifact's real preview path — hitting a vite dev port directly serves HTML for /api and login silently fails. The shop artifact is mounted at root on port 80; ERP at /erp.
- `pkill -f <pattern>` kills the calling script if the pattern appears in its own command line; put loops in a file.
- Verify captured images by reading a few — "capture succeeded" often meant an error page (找不到此頁面 / Something went wrong / 需要 ERP 權限).
