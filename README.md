# Gesture Fireworks · Live Text Flow

> Hand-controlled fireworks with real-time text reflow around active particles — celebrating 250 years of the US Constitution.

![Constitution](public/constitution.jpg)

![Demo](https://img.shields.io/badge/demo-localhost%3A5173-orange) ![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue) ![Vite](https://img.shields.io/badge/Vite-5.2-purple)

## What is this?

A browser demo that combines two ideas:

1. **Gesture Fireworks** — launch fireworks with your bare hands via webcam. Left-hand pinch launches a ground rocket; right-hand pinch triggers an instant burst at your fingertip.
2. **Live Text Reflow** — the full US Constitution is typeset in a two-column open-book layout using [`@chenglou/pretext`](https://github.com/chenglou/pretext). Every frame, the text re-lays itself out around the fireworks — as a rocket rises, the text parts like a curtain; as it explodes, a circular gap opens then closes as particles fade.

The reflow is the point. You can *see* pretext recomputing line breaks in real time at 60fps.

## Gestures

| Gesture | Effect |
|---|---|
| **Right hand pinch → release** | Instant burst explosion at fingertip |
| **Left hand pinch → release** | Ground rocket launches, rises, explodes mid-air |
| **Open palm swipe up** | Alternative rocket launch |

## Tech stack

- **Vite + TypeScript** — no framework, just vanilla TS
- **[@chenglou/pretext](https://www.npmjs.com/package/@chenglou/pretext)** — text measurement and per-line layout without DOM reflow
- **[MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)** — real-time hand landmark detection via CDN
- **Web Audio API** — synthesised charging tones + explosion sounds
- **DOM spans** — text rendered as absolutely-positioned `<span>` elements so it stays selectable and copyable

## How the reflow works

```
PREPARE (once, on text change ~10ms):
  prepareWithSegments(text, font)
  → caches every word's measured width via canvas.measureText

LAYOUT (every frame, ~1ms total):
  for each column (left page, right page):
    for each line row y:
      1. columnAvail(y, col, explosionRects)
         → find the widest unblocked horizontal span in this column
      2. layoutNextLine(prepared, cursor, availableWidth)
         → pure arithmetic, no DOM, ~0.003ms per call
      3. span.textContent = line.text  (pre-allocated pool, no GC)
         span.style.left/top = position
      4. cursor = line.end
```

Two occlusion shapes are passed each frame:
- **Rocket wake** — a tall narrow column that travels with the rocket, parting text as it rises
- **Explosion circle** — time-based disc (200–320px radius) that grows fast, holds, then shrinks

## Getting started

```bash
# Install dependencies
npm install

# Start dev server (requires webcam)
npm run dev
# → http://localhost:5173

# Production build
npm run build
npm run preview
```

> **Note:** Webcam access requires `localhost` or HTTPS. On mobile, use your LAN IP shown by Vite.

## Project structure

```
├── index.html           # Entry point, MediaPipe CDN, Google Fonts
├── src/
│   ├── main.ts          # App orchestrator, frame loop, book chrome
│   ├── particles.ts     # Particle system + getOcclusionRects()
│   ├── audio.ts         # Web Audio synthesis
│   ├── gestures.ts      # MediaPipe wrapper, gesture detection, hand renderer
│   ├── textFlow.ts      # pretext two-column layout engine
│   └── style.css        # Dark cyber + open-book aesthetic
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Credits

- Fireworks particle system and gesture logic adapted from [gesture-fireworks](https://github.com/michaelpersonal/gesture-fireworks)
- Text layout powered by [@chenglou/pretext](https://github.com/chenglou/pretext)
- Inspired by the Chika dancing text-reflow demo by [@EsotericCofe](https://twitter.com/EsotericCofe)
- Constitution text: public domain
