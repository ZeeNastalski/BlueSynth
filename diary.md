# BlueSynth Development Diary

## Purpose

This diary serves as a documentation of the design decisions, implementation choices, and architectural evolution of the BlueSynth project. It captures the reasoning behind key technical decisions, challenges encountered, and solutions implemented. This documentation will help:

- Track the evolution of the synthesizer's architecture
- Understand why certain design choices were made
- Document complex technical implementations
- Serve as a reference for future development
- Aid in knowledge transfer and onboarding

## Current Architecture (2024-02-20)

### Overview

BlueSynth is a web-based polyphonic synthesizer implemented using the Web Audio API. The architecture follows a modular design pattern, encapsulating different components of the synthesizer while maintaining a clear signal flow.

### Core Components

#### 1. Audio Engine
- **Web Audio Context**: Forms the foundation of the audio processing system
- **Polyphonic Voice Management**: 
  - Uses a Map structure (`activeNotes`) to track currently playing notes
  - Supports both MIDI and keyboard input
  - Each voice consists of 4 oscillators with independent controls

#### 2. Signal Chain
The audio signal flows through the following stages:

```
Oscillators (1-4) → Individual Gain Nodes → Filter → Master Gain → Master Level → Effects → Output
     ↑                     ↑                  ↑                                      ↑
     |                     |                  |                                      |
  Detune               Amplitude          Filter                                 Delay &
  Control              Envelope          Envelope                                Reverb
     ↑                     ↑                  ↑                                      ↑
     |                     |                  |                                      |
     └─────────────────── LFO ───────────────┘──────────────────────────────────────
```

#### 3. Key Features

##### Oscillators (4x)
- Waveform selection (sine, square, sawtooth, triangle)
- Octave control (-2 to +2)
- Detune control (-100 to +100 cents)
- Individual level control per oscillator

##### Filter Section
- Multiple filter types:
  - 6 dB/oct (1-pole)
  - 12 dB/oct (2-pole)
  - 24 dB/oct (4-pole)
- Frequency control (20 Hz - 20 kHz)
- Resonance control
- Dedicated ADSR envelope

##### Modulation
- LFO with multiple targets:
  - Oscillator levels
  - Oscillator detune
  - Filter frequency
  - Filter resonance
- Configurable:
  - Waveform
  - Rate (0.1 - 20 Hz)
  - Amount
  - Phase (0-360°)

##### Effects
- **Delay**:
  - Time (0-1000ms)
  - Feedback (0-90%)
  - Mix control
- **Reverb**:
  - Size parameter
  - Damping control
  - Mix control
  - Custom impulse response generation

##### Input Methods
- Virtual keyboard interface
- Computer keyboard mapping
- MIDI input support
  - Note on/off
  - Dynamic device connection handling

### Technical Implementation Details

#### 1. Voice Management
- Each voice is created with 4 oscillators
- Individual oscillator parameters are maintained per voice
- Voice allocation is handled through the `activeNotes` Map
- Proper cleanup of voices with envelope release

#### 2. Audio Processing
- Two-stage gain control:
  - Master gain with logarithmic processing for voice management
  - Master level control for overall volume
- Dynamic gain compensation based on active voices
- Careful management of audio parameter automation

#### 3. Performance Considerations
- Efficient handling of audio nodes
- Proper cleanup of unused nodes
- Optimized envelope calculations
- Level metering with minimal overhead

#### 4. UI Design
- Responsive grid layout
- Real-time parameter updates
- Visual feedback for levels and key presses
- Intuitive control grouping

### Future Considerations

1. **Potential Improvements**:
   - Preset system for saving/loading configurations
   - Additional modulation sources
   - More effect types
   - Extended MIDI control capabilities

2. **Performance Optimization Opportunities**:
   - Web Audio node pooling
   - More efficient voice allocation
   - Worklet-based processing for complex operations

3. **Feature Expansion**:
   - Additional filter types
   - Modulation matrix
   - Arpeggiator/sequencer
   - More sophisticated effects routing
