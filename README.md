# Waveform

An in-browser audio visualizer + mini-synth. Pure vanilla JS + WebAudio API — no dependencies, no build step.

## Features

- Three canvas visualizers at 60fps: FFT bars (gradient + glow), oscilloscope waveform, radial spectrum ring
- Polyphonic synth: sine/square/saw/triangle oscillators, playable via mouse/touch or computer keys (A–K whites, W E T Y U sharps)
- Lowpass filter, master volume, ADSR-style attack control
- Microphone input mode (analyzed, never monitored back — no feedback)
- "Panic" button (Esc) kills all voices

## Run

```bash
npx serve .          # or python3 -m http.server
```
Open the page, press a key (browser autoplay policy requires a gesture first — any keypress counts).

## Motion

Bar heights interpolate with exponential smoothing (`+= (target - cur) * 0.35` per frame) in the openmotion style; keys respond with a 90ms ease press and glow. `prefers-reduced-motion` respected.

## License

MIT
