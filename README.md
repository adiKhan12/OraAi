# OraAI

A floating AI screen companion for macOS. It follows your cursor, listens to your voice, sees your screen, and then moves to show you exactly what to click.

## What it does

You hold Option+Space and ask something like "how do I add text to this video?" — OraAI takes a screenshot, reads every UI element on screen using the macOS Accessibility API, sends it all to a vision model, and then the orb detaches from your cursor and floats to the exact button you need to press. It talks you through each step.

It works in any app. Firefox, CapCut, Calendar, VS Code, Blender — whatever you have open.

## How it works

The key insight is separating **localization** from **reasoning**:

- The macOS Accessibility API gives pixel-perfect positions of every button, text field, and menu item on screen
- A vision AI (GPT-4o via OpenRouter) looks at the screenshot + element list and decides *which* element to point to
- The orb animates to those coordinates while ElevenLabs TTS speaks the instruction

This gives way better accuracy than asking an AI model to guess pixel coordinates from a screenshot (which I tried first — it doesn't work).

## The orb states

- **Idle** — soft purple glow, follows your cursor
- **Listening** — warm amber pulse with expanding rings (recording your voice)
- **Thinking** — color-cycling spinner (transcribing + screenshotting + querying AI)
- **Guiding** — bright purple/gold, detaches from cursor, moves to targets with particle trail

## Setup

```bash
git clone https://github.com/adiKhan12/OraAi.git
cd OraAi
npm install
```

Create a `.env` file:
```
OPENROUTER_API_KEY=your-key-here
ELEVENLABS_API_KEY=your-key-here
```

Compile the accessibility helper:
```bash
swiftc -O -o helpers/ax-elements helpers/ax-elements.swift -framework Cocoa
```

Run in dev:
```bash
npm start
```

Build the app:
```bash
npm install --save-dev @electron/packager
npx @electron/packager . OraAI --platform=darwin --arch=arm64 --overwrite --app-bundle-id=com.oraai.app --extend-info=Info.plist --extra-resource=.env --extra-resource=helpers/ax-elements
codesign --force --deep --sign - OraAI-darwin-arm64/OraAI.app
```

Then open `OraAI-darwin-arm64/OraAI.app`.

## Permissions

macOS will ask for:
- **Microphone** — to hear your voice
- **Screen Recording** — to capture screenshots (grant to "OraAI" in System Settings)
- **Accessibility** — for the global hotkey and to read UI elements

## Tech stack

- Electron (transparent overlay window)
- HTML Canvas (orb rendering + animations)
- macOS Accessibility API via Swift helper (pixel-perfect element detection)
- OpenRouter / GPT-4o (vision + reasoning)
- ElevenLabs (speech-to-text + text-to-speech)

## Limitations

- Apps with poor accessibility support (like Spotify) fall back to AI coordinate estimation, which is less accurate
- macOS only for now (the Accessibility API is platform-specific)
- Needs API keys for OpenRouter and ElevenLabs

## Inspiration

Inspired by [Clicky by Farza Majeed](https://www.linkedin.com/posts/farza-majeed-76685612a_i-built-this-thing-called-clicky-its-an-activity-7447137675658244096-Ac9B/) — I saw the concept and wanted to build my own version with a different approach (macOS Accessibility API for pixel-perfect accuracy).

## License

MIT
