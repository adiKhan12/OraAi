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

## Quick install (download release)

1. Download the latest `.zip` from [Releases](https://github.com/adiKhan12/OraAi/releases)
2. Unzip and drag `OraAI.app` to your Applications folder
3. Add your API keys — open Terminal and run:
   ```bash
   mkdir -p ~/.oraai
   cat > ~/.oraai/.env << 'EOF'
   OPENROUTER_API_KEY=your-key-here
   ELEVENLABS_API_KEY=your-key-here
   EOF
   ```
   Get keys from [OpenRouter](https://openrouter.ai) and [ElevenLabs](https://elevenlabs.io)
4. Open OraAI and grant permissions when prompted
5. **Option+Space** to talk

## Build from source

```bash
git clone https://github.com/adiKhan12/OraAi.git
cd OraAi
npm install
```

Add your API keys:
```bash
mkdir -p ~/.oraai
cat > ~/.oraai/.env << 'EOF'
OPENROUTER_API_KEY=your-key-here
ELEVENLABS_API_KEY=your-key-here
EOF
```

Compile the accessibility helper and run:
```bash
swiftc -O -o helpers/ax-elements helpers/ax-elements.swift -framework Cocoa
npm start
```

Build the `.app` bundle:
```bash
npm run build
```

## Permissions

### Required
- **Microphone** — macOS prompts automatically on first launch. Click Allow.
- **Screen sharing** — OraAI shows a screen picker on first launch. Select your screen and click Share.

### First launch (Gatekeeper)
macOS may block OraAI because it's unsigned. Go to **System Settings → Privacy & Security**, scroll down, click **"Open Anyway"**.

### Optional: Accessibility (pixel-perfect mode)
OraAI works out of the box using AI vision to locate UI elements. But if you want **pixel-perfect** accuracy, enable Accessibility:

1. Go to **System Settings → Privacy & Security → Accessibility**
2. Click **"+"** and add `OraAI.app`
3. Toggle it **ON**

With Accessibility enabled, OraAI reads every button, text field, and menu directly from macOS — no coordinate guessing. Without it, OraAI uses Claude's vision to estimate positions, which works well but may be slightly off on some elements.

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

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — free to use, modify, and share for non-commercial purposes. Commercial use requires permission from the author.
