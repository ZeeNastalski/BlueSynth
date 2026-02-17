# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BlueSynth is a web-based polyphonic synthesizer built with vanilla JavaScript and the Web Audio API. No build tools, frameworks, or external dependencies.

## Running

Open `synth/index.html` directly in a modern browser. No build step, no server required.

## Project Structure

```
synth/
  index.html              UI markup (script tags load modules in dependency order)
  style.css               Grid-based responsive layout
  js/
    main.js               Entry point — instantiates and wires all modules
    audio-engine.js        AudioContext, finalSumming node, outputAnalyzer
    mixer.js               masterGain, masterLevel, normalization, osc levels, level metering
    filter.js              6/12/24 dB filter bank (cascaded BiquadFilters), frequency/Q, helpers
    effects.js             Delay + reverb + dry/wet routing, procedural IR generation
    envelope.js            Amplitude ADSR + filter ADSR (params + apply methods)
    lfo.js                 LFO oscillator + DC offset + target routing
    voice-manager.js       activeNotes Map, startNote/stopNote, oscillator creation
    ui.js                  All DOM event listeners and value display updates
    input-controller.js    MIDI, computer keyboard, virtual keyboard input
```

## Architecture

### Initialization Order (main.js)
1. `AudioEngine` — creates AudioContext, finalSumming, outputAnalyzer
2. `Mixer` — masterGain/masterLevel nodes, internal wiring to mixerAnalyzer
3. `FilterBank` — creates filters, connects outputs to mixer.masterGain
4. `EffectsChain` — delay/reverb/dry, wired from mixer.masterLevel to finalSumming
5. `EnvelopeEngine` — amplitude + filter ADSR parameter storage and apply methods
6. `LFO` — oscillator + DC offset chain, target routing
7. `VoiceManager` — receives envelopes, filterBank, lfo, mixer; orchestrates note on/off
8. LFO accessor wiring — `setVoiceAccessor`/`setFilterAccessor` callbacks resolve the runtime cycle
9. `UIController` — binds all DOM event listeners, receives all module references
10. `InputController` — MIDI/keyboard/virtual keyboard, receives voiceManager

### Audio Signal Flow
```
Oscillators (1-4, per voice) → Gain Nodes → FilterBank → masterGain → masterLevel
                                                                          ↓
    LFO modulates: osc levels,                                 ┌──── Dry → finalSumming → Output
    osc detune, filter freq, filter Q                          ├── Delay
                                                               └── Reverb
```

### Cross-Module Communication
- Modules communicate via direct method calls through constructor-injected references
- LFO accesses active voices and filter nodes via deferred accessor callbacks (avoids circular deps)
- VoiceManager is the central coordinator: startNote/stopNote call into envelopes, lfo, filterBank, mixer
- UIController is the glue between DOM events and module methods

### Key Design Decisions
- **Voice management**: `activeNotes` Map keyed by note string; each voice has 4 independent oscillators
- **Two-stage gain**: `masterGain` (dynamic normalization per voice count) → `masterLevel` (-3dB safety margin)
- **Filter implementation**: Cascaded BiquadFilterNodes for 6/12/24 dB/oct slopes
- **Reverb**: Procedurally generated impulse response — no external audio files
- **DOM as parameter source**: VoiceManager reads oscillator settings from DOM during startNote (DOM is source of truth for knob positions)
