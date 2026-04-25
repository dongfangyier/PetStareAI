---
name: Project Knowledge
description: Cumulative knowledge about PetStareAI development
type: project
last_updated: 2026-04-25
---

# Project Knowledge Base

## Project Overview

**Project Name**: PetStareAI
**Description**: A cute desktop pet that monitors your AI coding tools, displays different expressions based on activity, and provides a mini-game to play while waiting for AI to finish working
**Created**: 2026-04-17
**Updated**: 2026-04-25

## Architecture Decisions

### 1. Technology Stack Choice: Electron + React + Vite

**Why**:
- Electron provides excellent native integration for macOS
- React makes UI development fast and maintainable
- Vite provides fast hot-reload during development
- Mature ecosystem with good documentation
- Easy to package universal binaries for both Intel/ARM

**Alternatives considered**:
- SwiftUI: Native macOS only, not cross-platform
- Tauri: Lighter weight but less mature ecosystem
- Electron is battle-tested and easier to debug

### 2. Process Monitoring Approach

**Approach**: Hybrid detection:
1. **VSCode Claude Code**: Parse extension logs directly for most accurate `running`/`idle` state
2. **All AI tools**: Use Node.js `child_process` to execute `ps` command and parse output with multi-factor scoring

**Why**:
- Log parsing for VSCode Claude is the most accurate method - gets state directly from Claude
- `ps` approach works for all AI tools including terminal Claude and other apps
- Native to macOS, works on both Intel and ARM
- No native modules required
- Simple and reliable

### 3. Window Behavior: Floating Pet Always On Top

**Approach**: Pet window is always visible, no dock icon, right-click to quit. Tray icon removed per user request to simplify.

**Why**: User wants the pet visible on desktop at all times

### 4. Always On Top

**Approach**: Use Electron's `setAlwaysOnTop(true, 'floating')` when pet window is shown

**Why**: The pet should stay visible above other windows on the desktop

### 5. Mini-game when AI is busy (2026-04-24)

**Added**: When Claude/AI is running, a 🎮 button appears that opens a mini-game where you click popping colored balls

**Why**: Waiting for AI to complete tasks is boring - give the user something fun to do

### 6. Dynamic window sizing (2026-04-24)

**Changed from**: Fixed size → **Dynamic sizing**: 80×125 compact for cat only, 180×180 full when playing mini-game

**Why**: Keep the cat small when not playing, expand for game area

## Requirements Recap

### Original Requirements (2026-04-17)
- ✅ Monitor multiple running AI tools simultaneously
- ✅ Support macOS Intel and Apple Silicon
- ✅ Draggable desktop pet window
- ✅ Visual status indicators with different expressions
- ✅ Git repository with proper .gitignore
- ✅ CLAUDE.agent structure with documentation
- ✅ Always on top window

### Updated Requirements (2026-04-19)
- ✅ Focus on Claude Code monitoring with improved detection
- ✅ Add configuration GUI structure
- ✅ Different cat expressions for idle/busy/success/error/sleeping
- ✅ Auto-sleep after 5 minutes idle
- ✅ Interactivity: click to wake, double-click for config

### 2026-04-24 Additions
- ✅ Mini-game: click popping balls while waiting for AI to finish
- ✅ Dynamic window sizing (compact / full)
- ✅ Game auto-closes when AI finishes
- ✅ Allow dragging during game play

## Current Architecture

### Electron Main Process (`electron/main.js`)
- Creates and manages the always-on-top transparent window
- Monitors `ps` to detect AI tool running status
- VSCode Claude Code detection via log file parsing (most accurate)
- IPC communication with renderer
- Window position persistence (handled by renderer drag -> IPC set position)
- Dynamic window resizing for mini-game

### React Frontend (`src/`)
- `src/main.jsx` - React entry point
- `src/App.jsx` - Main app component, manages cat state, listens for IPC status updates
  - Handles idle → sleep transition after 5 minutes
  - Starts mini-game when button clicked during busy state
  - Auto-stops mini-game when AI completes
- `src/index.css` - Global styles
- `src/App.css` - App container and drag area styling
- `src/components/CatFace.jsx` - Cat face component with CSS animations for each state
  - 5 animated states: idle/busy/success/error/sleeping
- `src/components/CatFace.css` - Styles for cat face including state animations (breathing, nervous movement)
- `src/components/MiniGame.jsx` - Click-to-pop colored balls mini-game
  - Spawns random balls at random intervals
  - Score tracking + floating text + auto-cleanup
- `src/components/MiniGame.css` - Game styling
- `src/components/ConfigPanel.jsx` - Configuration modal (placeholder for future)
- `src/components/ConfigPanel.css` - Config styles

## Supported AI Tools

| Tool | Detection Method | Status |
|------|------------------|--------|
| Claude Code VSCode Extension | Log parsing + multi-factor ps process scoring | ✅ **Fully Supported** |
| Claude Code CLI | ps process detection | ✅ **Fully Supported** |
| Claude Desktop | ps | ⚙️ Pending |
| Cursor | ps | ⚙️ Pending |
| ChatGPT | ps | ⚙️ Pending |
| Gemini | ps | ⚙️ Pending |
| OpenCode | ps | ⚙️ Pending |
| Ollama | ps | ⚙️ Pending |
| LM Studio | ps | ⚙️ Pending |
| VS Code | ps | ⚙️ Pending |

> **Note**: Currently the project is focused on Claude Code exclusively per requirements. Other AI tools are declared in the process patterns but haven't been tested or prioritized.

## Detection Logic

### VSCode Claude Code Extension (Most Accurate)
1. Find last 20 recently modified `Claude VSCode.log` files (cached for 30s)
2. Read the last 16KB of each file from the end
3. Look for `update_session_state` with `"state":"running"` / `"state":"idle"`
4. If log says running within last 5 minutes → counted as active
5. Fallback: if no state found but file modified in last 2 minutes → counted as active

### General Process Detection
For each detected Claude process:
- Check if process has active non-shell child processes → **active**
- For terminal Claude: check if process state = R (running) → **active**

This simple approach minimizes false positives.

### Debouncing
- Need **2 consecutive inactive checks** before switching from busy → idle
- Prevents flickering from transient CPU spikes/drops

## Configuration Schema

Configuration is stored at `~/.petstareai/config.json` (reserved for future):
```json
{
  "apiKey": "",
  "defaultModel": "claude-3-opus-20240229",
  "agents": [],
  "skills": [],
  "hooks": {
    "onComplete": true,
    "onError": true
  }
}
```

## Cat States

| State | Trigger | Animation |
|-------|---------|-----------|
| Idle | No active AI tasks | Normal smile, slow breathing |
| Busy | One or more AI tasks running | Nervous mouth, subtle eye movement |
| Success | AI just finished | Big happy smile |
| Error | AI finished with error | Sad frown |
| Sleeping | Idle for 5+ minutes | Closed eyes, slow breathing |

## Mini-game (Playing State)

When AI is busy:
- 🎮 button appears on the cat
- Click to start game → window expands to 180×180
- Random colored balls spawn at random positions with random intervals (0.8-1.2s)
- Click a ball → +1 point, **+1 floating text animation**, ball disappears
- In-game menu with exit button to close game early
- You can drag the cat anywhere **while the game is active**
- Max 10 active balls
- Balls auto-disappear after 3-5 seconds if not clicked
- When AI finishes working, game automatically closes and window shrinks back

## Building & Packaging

- `npm install` - install dependencies
- `npm run build` - Vite builds React to `dist/`
- `npm run electron:build` - builds React then packages with electron-builder
- `npm run package` - electron-builder packages into DMG for both x64 and arm64

## Output Location

Built DMG files:
- Intel x64: `dist/PetStareAI-1.0.0.dmg`
- Apple Silicon ARM64: `dist/PetStareAI-1.0.0-arm64.dmg`

App bundles:
- Intel x64: `dist/mac/PetStareAI.app`
- Apple Silicon ARM64: `dist/mac-arm64/PetStareAI.app`

## Change Log

### 2026-04-17 - Project Initialization

- Created project structure
- Set up CLAUDE.agent documentation system
- Decided on Electron + React + Vite architecture
- Created initial project skeleton
- Added multi-AI-tool monitoring

### 2026-04-17 - Fixed visibility issues
- Fixed window positioning to guarantee visibility
- Fixed asset path resolution for packaged app
- Fixed tray icon rendering

### 2026-04-17 - Refined UI
- Shrunk cat size
- Added ears and whiskers
- Fixed layout
- Removed extra UI elements

### 2026-04-19 - Major Refactor: Improved Claude Code Detection
- Improved VSCode Claude Code detection with log parsing
- Added multi-factor scoring for processes
- Added debouncing to reduce flickering
- Updated all documentation

### 2026-04-23 - New Features
- Added allow dragging while game is playing
- Fixed transparent area click-through issues
- Adjusted debounce timing for more responsive detection

### 2026-04-24 - Mini-game Added
- Added mini-game: click popping colored balls when AI is busy
- Added dynamic window resizing (compact 80×125 / full 180×180)
- Auto-close game when AI finishes
- Updated all documentation (README.md, CLAUDE.md, project knowledge)

### 2026-04-25 - Simplifications
- Removed special website-opening balls from mini-game, kept only simple colored balls
- Removed CPU and memory scoring from process detection logic (now only child process detection)
- Added installation instructions to DMG and README for macOS "file is damaged" warning
