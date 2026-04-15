# Kwami Navigation Extension

Chrome/Edge extension for the Kwami playground. Uses a **real browser tab** for navigation instead of an iframe proxy, so:

- Any site works (no X-Frame-Options or iframe blocking)
- Sign-in and cookies work (same browser session)
- Kwami can still navigate, click, type, and read the page via the extension

## Development

This extension is built with **TypeScript** and **Vite**.

### Prerequisites
- Node.js (v18+)
- pnpm (Default package manager)

### Setup
```bash
# Install dependencies
pnpm install

# Build the extension
pnpm build

# Development mode (with HMR)
pnpm dev
```

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist` folder generated after running `pnpm build`

## Usage

1. Build and load the extension, then open the Kwami playground (localhost or kwami.io).
2. When you ask Kwami to open a URL, the extension opens (or reuses) a tab and keeps the playground in sync (URL, title, page content for the agent).
3. Close the navigation tab or use “Close navigation” in the playground to stop.

## Message contract

- **Playground → Extension**: `window.postMessage({ source: 'kwami-playground', type: 'kwami:nav_command', detail: { action, url?, description?, text? } }, '*')`
- **Extension → Playground**: content script posts messages with `source: 'kwami-extension'` and types `kwami:ext_nav_state`, `kwami:ext_page_content`, `kwami:ext_command_result`, `kwami:ext_nav_ended`
