# PetStareAI - Project for Claude Code

This is a desktop pet application that monitors AI coding tools and entertains you while waiting.

## Build Commands

- `npm install` - Install dependencies
- `npm run dev` - Start Vite dev server
- `npm run build` - Build React frontend to `dist/`
- `npm run electron:dev` - Start Vite + Electron for development
- `npm run electron:build` - Build frontend and package into DMG installer
- `npm run package` - Package with electron-builder only

## Project Structure

- `electron/main.js` - Electron main process: process monitoring, window management, IPC
- `src/App.jsx` - Main React component, handles state and IPC
- `src/components/CatFace.jsx` - Animated cat face with 5 states
- `src/components/MiniGame.jsx` - Click-to-pop balls mini-game for when AI is busy
- `src/components/ConfigPanel.jsx` - Configuration modal (placeholder)
- `assets/` - Icons and assets for packaging
- `dist/` - Build output (DMG files)

## Key Features

- Multi-tool AI monitoring (Claude Code, Claude Desktop, Cursor, ChatGPT, Gemini, Ollama, etc.)
- Animated cat expressions for each state (idle/busy/success/error/sleeping)
- Mini-game: click popping balls while waiting for AI
- Draggable, always-on-top, transparent window
- Click-through on transparent areas
- Auto-sleep after 5 minutes idle
- Built for macOS (universal binary: arm64 + x64 DMG)

## Implementation Notes

- **Process detection**: Combines `ps` parsing + VSCode Claude extension log parsing
- **VSCode log detection**: Checks last 20 recent log files, reads tail for `update_session_state` entries
- **Anti-jitter debouncing**: Requires 2 consecutive inactive checks before switching to idle
- **Window sizing**: 80x125 compact (cat only), 180x180 full (with mini-game)
- **No dock icon**: app.dock.hide() on macOS - right-click cat to quit
- **No tray icon**: Tray icon removed per request - cat is always visible on desktop

## Packaging Output

- `dist/PetStareAI-1.0.0-arm64.dmg` - Apple Silicon installer
- `dist/PetStareAI-1.0.0.dmg` - Intel installer
- `dist/mac-arm64/PetStareAI.app` - ARM64 app bundle
- `dist/mac/PetStareAI.app` - Intel app bundle
