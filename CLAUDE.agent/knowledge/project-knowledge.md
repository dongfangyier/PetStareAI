---
name: Project Knowledge
description: Cumulative knowledge about PetStareAI development
type: project
last_updated: 2026-04-17
---

# Project Knowledge Base

## Project Overview

**Project Name**: PetStareAI
**Description**: A desktop pet application that monitors running status of various AI tools on macOS
**Created**: 2026-04-17

## Architecture Decisions

### 1. Technology Stack Choice: Electron + React + Vite

**Why**:
- Electron provides excellent cross-platform support for macOS
- React makes UI development fast and maintainable
- Vite provides fast hot-reload during development
- Mature ecosystem with good documentation

**Alternatives considered**:
- SwiftUI: Native macOS only, not cross-platform
- Tauri: Lighter weight but less mature ecosystem
- Electron is battle-tested and easier to package for both Intel/ARM

### 2. Process Monitoring Approach

**Approach**: Use Node.js `child_process` to execute `ps` command and parse output
**Why**:
- Native to macOS, works on both Intel and ARM
- No native modules required
- Simple and reliable
- Easy to add new process names to monitor

### 3. Always On Top

**Approach**: Use Electron's `setAlwaysOnTop` API
**Why**: This is a desktop pet that should always be visible

## Requirements Recap

- ✅ Monitor multiple running AI tools simultaneously
- ✅ Support macOS Intel and Apple Silicon
- ✅ Draggable desktop pet window
- ✅ Visual status indicators
- ✅ Git repository with proper .gitignore
- ✅ CLAUDE.agent structure with documentation

## Change Log

### 2026-04-17 - Project Initialization

- Created project structure
- Set up CLAUDE.agent documentation system
- Decided on Electron + React + Vite architecture
- Created initial project skeleton

## Known AI Tool Process Names for Monitoring

- Claude Desktop: `Claude`
- Claude CLI: `claude`
- OpenAI ChatGPT: `ChatGPT`
- Gemini: `Gemini`
- Cursor Editor: `Cursor`
- VSCode with AI extensions: `Code`
- Ollama: `ollama`
- LM Studio: `LM Studio`
