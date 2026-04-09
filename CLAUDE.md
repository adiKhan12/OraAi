# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OraAI is an Electron-based cross-platform desktop app — a floating AI screen companion that follows your cursor, listens to voice commands, sees your screen, and guides you where to click. It uses a transparent full-screen overlay window with Canvas 2D rendering.

## Commands

| Command | Purpose |
|---------|---------|
| `npm start` | Run in dev mode (Electron) |
| `npm run build` | Build macOS app (compiles Swift helper + packages + signs + zips) |
| `npm version patch/minor/major` | Bump version, commit, and git tag |
| `swiftc -O -o helpers/ax-elements helpers/ax-elements.swift -framework Cocoa` | Compile accessibility helper standalone |

No test framework is configured. Pushing a `v*` tag triggers `.github/workflows/release.yml` which builds macOS (arm64) and Windows (x64) zips and creates a GitHub release.

## Architecture

**Main process** (`main.js`) — Electron app entry. Loads `.env` from `~/.oraai/.env` → `<project>/.env` → `<resources>/.env`. Creates a transparent, always-on-top, frameless overlay window. Registers Alt+Space hotkey. Broadcasts mouse position to renderer every 16ms via IPC. Spawns macOS Swift accessibility helper on demand.

**Preload bridge** (`preload.js`) — Exposes `window.oraAPI` with strict contextIsolation. Single IPC surface: event listeners (`onMouseMove`, `onHotkey`, `onSettingChanged`) and async calls (`getConfig`, `getScreenInfo`, `getAXElements`).

**Renderer** (`renderer/`) — All loaded by `index.html` in order:
- `states.js` — 4-state machine: IDLE → LISTENING → THINKING → GUIDING
- `orb.js` — Canvas 2D orb with spring physics (spring=0.12, damping=0.7), state-specific visuals, particle system
- `audio-recorder.js` — Microphone capture with silence detection (1500ms threshold at RMS 0.015)
- `screen-capture.js` — `getDisplayMedia` → hidden video → canvas → JPEG base64
- `guide-controller.js` — Animates orb to targets, shows tooltips/target rings, speaks instructions via TTS
- `app.js` — Orchestrator. Wires state machine, orb, audio, screen capture, and services together. Core pipeline: hotkey → record → silence-stop → parallel(transcribe + screenshot + AX elements) → vision AI → guide or speak

**Services** (`services/`):
- `vision.js` — Dual-mode: **Accessibility mode** (≥15 useful elements → GPT-4o with element list → JSON steps) vs **Vision fallback** (downscale to 1280px → Claude Sonnet 4 → `[POINT:x,y]` coordinates). Maintains 10-exchange conversation history.
- `stt.js` — ElevenLabs `scribe_v1` speech-to-text
- `tts.js` — ElevenLabs `eleven_turbo_v2_5` TTS with voice "Rachel", plays via WebAudio API

**Native** (`helpers/ax-elements.swift`) — macOS Accessibility API helper. Recursively walks UI tree (30 depth, 500 cap), filters interactive roles (Button, TextField, etc.), outputs JSON with center-point coordinates. macOS only; skipped on Windows.

## Key Data Flow

```
Alt+Space → LISTENING → silence detected → THINKING
  → Promise.all([ STT(audio), screenshot(), AXElements() ])
  → vision.analyze(screenshot, transcript, elements)
  → GUIDING: orb animates to each step target + TTS speaks instruction
  → IDLE
```

## Platform Differences

- **macOS**: Accessibility API available for pixel-perfect element detection. Swift helper compiled and bundled. Code signing with `-` (self-sign).
- **Windows**: Vision fallback only (no accessibility API). No Swift helper. `.env` at `%USERPROFILE%\.oraai\.env`.

## Environment Variables

Two required API keys loaded via dotenv: `OPENROUTER_API_KEY` (OpenRouter for Claude/GPT-4o) and `ELEVENLABS_API_KEY` (ElevenLabs STT + TTS).

## Conventions

- Class-based OOP for all major components
- Console logging prefixed with `"OraAI:"`
- No external UI frameworks — vanilla Canvas + CSS
- `contextIsolation: true`, `nodeIntegration: false` — all renderer↔main communication through preload bridge
- Underscore prefix for private properties (e.g., `_monitorInterval`)
