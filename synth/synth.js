class Synthesizer {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.activeNotes = new Map();
        this.midiAccess = null;
        this.initMIDI();
        
        // Create analyzers for level monitoring
        this.outputAnalyzer = this.audioContext.createAnalyser();
        this.outputAnalyzer.fftSize = 1024;
        this.outputAnalyzer.smoothingTimeConstant = 0.2;

        this.mixerAnalyzer = this.audioContext.createAnalyser();
        this.mixerAnalyzer.fftSize = 1024;
        this.mixerAnalyzer.smoothingTimeConstant = 0.2;

        // Create final summing node
        this.finalSumming = this.audioContext.createGain();
        this.finalSumming.gain.value = 1.0;

        // Create master gain nodes
        this.masterGain = this.audioContext.createGain();
        this.masterLevel = this.audioContext.createGain();
        this.masterLevel.gain.value = 1.0;
        
        // Create delay effect
        this.delay = {
            delayNode: this.audioContext.createDelay(1.0),
            feedback: this.audioContext.createGain(),
            mix: this.audioContext.createGain()
        };
        this.delay.delayNode.delayTime.value = 0.2; // 200ms
        this.delay.feedback.gain.value = 0.3; // 30%
        this.delay.mix.gain.value = 0.3; // 30%

        // Create reverb effect
        this.reverb = {
            convolver: this.audioContext.createConvolver(),
            mix: this.audioContext.createGain()
        };
        this.reverb.mix.gain.value = 0.2; // 20%

        // Create dry/wet mix nodes
        this.dryGain = this.audioContext.createGain();
        this.dryGain.gain.value = 1;

        // Connect effects chain
        this.masterGain.connect(this.mixerAnalyzer);
        this.masterGain.connect(this.masterLevel);
        this.masterLevel.connect(this.dryGain);
        this.dryGain.connect(this.finalSumming);
        
        // Delay chain
        this.masterLevel.connect(this.delay.delayNode);
        this.delay.delayNode.connect(this.delay.feedback);
        this.delay.feedback.connect(this.delay.delayNode);
        this.delay.delayNode.connect(this.delay.mix);
        this.delay.mix.connect(this.finalSumming);

        // Reverb chain
        this.masterLevel.connect(this.reverb.convolver);
        this.reverb.convolver.connect(this.reverb.mix);
        this.reverb.mix.connect(this.finalSumming);
        
        // Connect final summing to analyzer and output
        this.finalSumming.connect(this.outputAnalyzer);
        this.finalSumming.connect(this.audioContext.destination);
        this.masterGain.gain.value = 1;

        // Generate reverb impulse response
        this.generateReverbIR();

        // Start level monitoring
        this.startLevelMonitoring();

        // Create filters for different pole configurations
        this.filters = {
            lowpass6: this.audioContext.createBiquadFilter(),  // 1-pole (6 dB/oct)
            lowpass12: this.audioContext.createBiquadFilter(), // 2-pole (12 dB/oct)
            lowpass24: [                                       // 4-pole (24 dB/oct)
                this.audioContext.createBiquadFilter(),
                this.audioContext.createBiquadFilter()
            ]
        };

        // Initialize all filters as lowpass
        [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
            filter.type = 'lowpass';
            filter.frequency.value = 20000;
            filter.Q.value = 0;
        });

        // Special setup for multi-pole filters
        this.filters.lowpass12.Q.value = 0.707; // Butterworth response
        this.filters.lowpass24[0].Q.value = 0.54;
        this.filters.lowpass24[1].Q.value = 1.31;

        // Connect 4-pole filters in series
        this.filters.lowpass24[0].connect(this.filters.lowpass24[1]);
        this.filters.lowpass24[1].connect(this.masterGain);

        // Connect other filters to master gain
        this.filters.lowpass6.connect(this.masterGain);
        this.filters.lowpass12.connect(this.masterGain);

        // Normalization settings
        this.normalizationType = 'logarithmic';
        this.voiceScaling = 0.75;

        // Calculate total gain and apply dynamic compression
        this.updateMasterGain = () => {
            // Get current oscillator levels and number of active notes
            const totalLinearGain = this.osc1Level + this.osc2Level + this.osc3Level + this.osc4Level;
            const activeNoteCount = Math.max(1, this.activeNotes.size);
            
            if (this.normalizationType === 'logarithmic') {
                // Apply logarithmic gain reduction with adjustable voice scaling
                const scaleFactor = Math.max(1, Math.pow(activeNoteCount, this.voiceScaling / 100));
                const logGain = Math.log10(1 + totalLinearGain * scaleFactor) / Math.log10(2);
                
                // Additional safety headroom (-12dB)
                this.masterGain.gain.value = 0.25 / Math.max(1, logGain);
            } else {
                // Linear gain reduction with adjustable voice scaling
                this.masterGain.gain.value = 0.5 / Math.max(1, Math.pow(activeNoteCount, this.voiceScaling / 100));
            }
            
            // Scale master level to prevent clipping
            const masterLevelScaling = 0.7; // -3dB safety margin
            this.masterLevel.gain.value = (parseInt(document.getElementById('master-level').value) / 100) * masterLevelScaling;
        };

        // Start mixer level monitoring
        const updateMixerMeter = () => {
            const meter = document.getElementById('mixer-level-meter');
            if (!meter) return;

            const dataArray = new Float32Array(this.mixerAnalyzer.frequencyBinCount);
            this.mixerAnalyzer.getFloatTimeDomainData(dataArray);
            
            // Calculate RMS value
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            
            // Convert to dB
            const db = 20 * Math.log10(rms);
            
            // Map dB to height percentage (-60dB to 0dB)
            const height = Math.max(0, Math.min(100, (db + 60) * 1.67));
            
            // Update meter height and color
            meter.style.height = `${height}%`;
            
            // Add clipping class if level is too high (above -3dB)
            if (db > -3) {
                meter.classList.add('clipping');
            } else {
                meter.classList.remove('clipping');
            }

            requestAnimationFrame(updateMixerMeter);
        };
        
        updateMixerMeter();

        // Current active filter
        this.currentFilter = this.filters.lowpass24[0];
        this.currentFilterType = 'lowpass24';

        // Store oscillator levels
        this.osc1Level = 0.25;
        this.osc2Level = 0.25;
        this.osc3Level = 0.25;
        this.osc4Level = 0.25;

        // Amplitude envelope parameters (in milliseconds)
        this.envelope = {
            attack: 100,
            decay: 200,
            sustain: 0.7,
            release: 500,
            retrigger: true,
            isActive: false // Track if envelope is currently active
        };

        // Filter envelope parameters
        this.filterEnvelope = {
            attack: 100,
            decay: 200,
            sustain: 0.7,
            release: 500,
            amount: 0.5, // 0-1 range for modulation amount
            baseFreq: 20000, // Store base frequency separate from modulated value
            retrigger: true,
            isActive: false // Track if envelope is currently active
        };

        // LFO parameters
        this.lfo = {
            oscillator: this.audioContext.createOscillator(),
            gain: this.audioContext.createGain(),
            target: 'none',
            targetParams: new Set(), // Store multiple target parameters
            baseValue: 0
        };

        // Initialize LFO with DC offset for bipolar modulation
        this.lfo.oscillator.type = 'sine';
        this.lfo.oscillator.frequency.value = 1;
        
        // Create DC offset
        this.lfo.offset = this.audioContext.createConstantSource();
        this.lfo.offset.offset.value = 1;
        this.lfo.offset.start();
        
        // Create gain nodes for bipolar modulation
        this.lfo.depthGain = this.audioContext.createGain();
        this.lfo.depthGain.gain.value = 0.5;
        
        // Connect for bipolar modulation
        this.lfo.oscillator.connect(this.lfo.depthGain);
        this.lfo.depthGain.connect(this.lfo.gain);
        this.lfo.offset.connect(this.lfo.gain);
        
        this.lfo.oscillator.start();

        // Keyboard octave shift
        this.baseOctave = 0; // Can be -2 to +2
        
        // Initialize master gain based on default oscillator levels
        this.updateMasterGain();
        
        // Add master level control
        document.getElementById('master-level').addEventListener('input', (e) => {
            const value = parseInt(e.target.value) / 100;
            this.masterLevel.gain.value = value;
            e.target.parentElement.querySelector('.value').textContent = e.target.value;
        });

        // Add envelope retrigger controls
        document.getElementById('env-retrigger').addEventListener('change', (e) => {
            this.envelope.retrigger = e.target.checked;
        });

        document.getElementById('filter-env-retrigger').addEventListener('change', (e) => {
            this.filterEnvelope.retrigger = e.target.checked;
        });

        this.setupEventListeners();

        // Method to update LFO target
        this.updateLfoTarget = (targetId) => {
            // Disconnect from all previous targets
            this.lfo.gain.disconnect();
            this.lfo.targetParams.clear();

            this.lfo.target = targetId;
            
            if (targetId === 'none') return;

            // Get amount from slider
            const amount = parseInt(document.getElementById('lfo-amount').value) / 100;
            
            // Update modulation depth based on target type
            switch (targetId) {
                case 'filter-freq':
                    // Convert to frequency range
                    const minFreq = Math.log2(20);
                    const maxFreq = Math.log2(20000);
                    const scale = (maxFreq - minFreq) / 100;
                    const baseFreq = Math.pow(2, minFreq + (parseFloat(document.getElementById('filter-freq').value) * scale));
                    this.lfo.depthGain.gain.value = baseFreq * amount;
                    this.lfo.gain.connect(this.currentFilter.frequency);
                    this.lfo.targetParams.add(this.currentFilter.frequency);
                    break;
                    
                case 'filter-q':
                    this.lfo.depthGain.gain.value = 5 * amount;
                    this.lfo.gain.connect(this.currentFilter.Q);
                    this.lfo.targetParams.add(this.currentFilter.Q);
                    break;
                    
                case 'osc1-level':
                case 'osc2-level':
                case 'osc3-level':
                case 'osc4-level':
                    const oscIndex = parseInt(targetId.charAt(3)) - 1;
                    this.lfo.depthGain.gain.value = 0.5 * amount;
                    this.activeNotes.forEach(oscillators => {
                        this.lfo.gain.connect(oscillators[oscIndex].gainNode.gain);
                        this.lfo.targetParams.add(oscillators[oscIndex].gainNode.gain);
                    });
                    break;
                    
                case 'osc1-detune':
                case 'osc2-detune':
                case 'osc3-detune':
                case 'osc4-detune':
                    const detuneOscIndex = parseInt(targetId.charAt(3)) - 1;
                    this.lfo.depthGain.gain.value = 50 * amount;
                    this.activeNotes.forEach(oscillators => {
                        this.lfo.gain.connect(oscillators[detuneOscIndex].oscillator.detune);
                        this.lfo.targetParams.add(oscillators[detuneOscIndex].oscillator.detune);
                    });
                    break;
            }
        };
    }

    startLevelMonitoring() {
        const updateMeter = () => {
            const meter = document.getElementById('output-level-meter');
            if (!meter) return;

            const dataArray = new Float32Array(this.outputAnalyzer.frequencyBinCount);
            this.outputAnalyzer.getFloatTimeDomainData(dataArray);
            
            // Calculate RMS value
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            
            // Convert to dB
            const db = 20 * Math.log10(rms);
            
            // Map dB to height percentage (-60dB to 0dB)
            const height = Math.max(0, Math.min(100, (db + 60) * 1.67));
            
            // Update meter height and color
            meter.style.height = `${height}%`;
            
            // Add clipping class if level is too high (above -3dB)
            if (db > -3) {
                meter.classList.add('clipping');
            } else {
                meter.classList.remove('clipping');
            }

            requestAnimationFrame(updateMeter);
        };
        
        updateMeter();
    }

    updateOctaveDisplay() {
        const startOctave = 4 + this.baseOctave;
        const endOctave = 5 + this.baseOctave;
        document.getElementById('octave-display').textContent = `C${startOctave}-F${endOctave}`;
    }

    shiftOctave(delta) {
        const newOctave = this.baseOctave + delta;
        if (newOctave >= -2 && newOctave <= 2) {
            this.baseOctave = newOctave;
            this.updateOctaveDisplay();
            // Update all key data-note attributes
            document.querySelectorAll('.key[data-note]').forEach(key => {
                const note = key.dataset.note;
                const noteName = note.slice(0, -1);
                const octave = parseInt(note.slice(-1));
                key.dataset.note = noteName + (octave + delta);
            });
        }
    }

    createOscillator(frequency, settings, level) {
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        osc.type = settings.waveType;
        osc.frequency.value = frequency;
        osc.detune.value = settings.detune;
        
        // Apply octave shift
        const octaveShift = settings.octave * 12;
        osc.frequency.value *= Math.pow(2, octaveShift / 12);
        
        osc.connect(gainNode);
        gainNode.connect(this.currentFilter);
        gainNode.gain.value = 0; // Start silent
        
        return { oscillator: osc, gainNode, baseLevel: level };
    }

    applyAmplitudeEnvelope(gainNode, baseLevel, isNoteOn) {
        const now = this.audioContext.currentTime;
        const gain = gainNode.gain;
        gain.cancelScheduledValues(now);

        if (isNoteOn) {
            // Only retrigger if retrigger is enabled or envelope is not active
            if (this.envelope.retrigger || !this.envelope.isActive) {
                // Attack
                gain.setValueAtTime(0, now);
                gain.linearRampToValueAtTime(baseLevel, now + this.envelope.attack / 1000);

                // Decay and Sustain
                gain.linearRampToValueAtTime(
                    baseLevel * this.envelope.sustain,
                    now + (this.envelope.attack + this.envelope.decay) / 1000
                );
                this.envelope.isActive = true;
            } else {
                // If not retriggering, maintain current value
                const currentValue = gain.value;
                gain.setValueAtTime(currentValue, now);
            }
        } else {
            // Release - using exponential decay for more natural sound
            const currentValue = gain.value;
            gain.setValueAtTime(currentValue, now);
            // Exponential ramp can't go to 0, so we use a very small value
            gain.exponentialRampToValueAtTime(0.00001, now + this.envelope.release / 1000);
            // Then we set it to 0 immediately after
            gain.setValueAtTime(0, now + this.envelope.release / 1000);

            // If this was the last note, mark envelope as inactive
            if (this.activeNotes.size === 1) {
                this.envelope.isActive = false;
            }
        }
    }

    applyFilterEnvelope(isNoteOn) {
        const now = this.audioContext.currentTime;
        const baseFreq = this.filterEnvelope.baseFreq;
        const amount = this.filterEnvelope.amount;
        
        // Calculate maximum frequency shift (up to 4 octaves above base frequency)
        const maxFreqShift = baseFreq * 16; // 4 octaves = 16x frequency
        const freqRange = maxFreqShift - baseFreq;
        
        [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
            filter.frequency.cancelScheduledValues(now);
            
            if (isNoteOn) {
                // Only retrigger if retrigger is enabled or envelope is not active
                if (this.filterEnvelope.retrigger || !this.filterEnvelope.isActive) {
                    // Start from current frequency
                    filter.frequency.setValueAtTime(baseFreq, now);
                    
                    // Attack - sweep up to max frequency
                    const peakFreq = baseFreq + (freqRange * amount);
                    filter.frequency.exponentialRampToValueAtTime(peakFreq, now + this.filterEnvelope.attack / 1000);
                    
                    // Decay and Sustain
                    const sustainFreq = baseFreq + (freqRange * amount * this.filterEnvelope.sustain);
                    filter.frequency.exponentialRampToValueAtTime(
                        sustainFreq,
                        now + (this.filterEnvelope.attack + this.filterEnvelope.decay) / 1000
                    );
                    this.filterEnvelope.isActive = true;
                } else {
                    // If not retriggering, maintain current value
                    const currentFreq = filter.frequency.value;
                    filter.frequency.setValueAtTime(currentFreq, now);
                }
            } else {
                // Release - return to base frequency
                const currentFreq = filter.frequency.value;
                filter.frequency.setValueAtTime(currentFreq, now);
                filter.frequency.exponentialRampToValueAtTime(
                    baseFreq,
                    now + this.filterEnvelope.release / 1000
                );

                // If this was the last note, mark envelope as inactive
                if (this.activeNotes.size === 1) {
                    this.filterEnvelope.isActive = false;
                }
            }
        });
    }

    noteToFrequency(note) {
        if (typeof note === 'number') {
            // MIDI note number to frequency
            return 440 * Math.pow(2, (note - 69) / 12);
        } else {
            // Note name to frequency (e.g. "C4")
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const octave = parseInt(note.slice(-1));
            const noteIndex = notes.indexOf(note.slice(0, -1));
            return 440 * Math.pow(2, (noteIndex - 9) / 12 + (octave - 4));
        }
    }

    midiNoteToNoteName(midiNote) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12) - 1;
        const noteIndex = midiNote % 12;
        return notes[noteIndex] + octave;
    }

    updateMIDIStatus() {
        const statusElement = document.getElementById('midi-status');
        if (!statusElement) return;

        if (!this.midiAccess) {
            statusElement.textContent = 'MIDI: Not Supported';
            statusElement.classList.remove('connected');
            return;
        }

        let hasActiveInput = false;
        this.midiAccess.inputs.forEach(input => {
            if (input.state === 'connected') {
                hasActiveInput = true;
            }
        });

        if (hasActiveInput) {
            statusElement.textContent = 'MIDI: Connected';
            statusElement.classList.add('connected');
        } else {
            statusElement.textContent = 'MIDI: Not Connected';
            statusElement.classList.remove('connected');
        }
    }

    async initMIDI() {
        if (!navigator.requestMIDIAccess) {
            console.log('WebMIDI is not supported in this browser');
            this.updateMIDIStatus();
            return;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();
            
            // Listen for MIDI device connections/disconnections
            this.midiAccess.onstatechange = (e) => {
                console.log(`MIDI device ${e.port.name} ${e.port.state}`);
                this.updateMIDIStatus();
            };

            // Set up MIDI input handling
            this.midiAccess.inputs.forEach(input => {
                input.onmidimessage = this.handleMIDIMessage.bind(this);
                console.log(`MIDI input device connected: ${input.name}`);
            });
            
            // Update initial MIDI status
            this.updateMIDIStatus();
        } catch (error) {
            console.error('Error accessing MIDI devices:', error);
        }
    }

    handleMIDIMessage(message) {
        const [status, note, velocity] = message.data;
        const command = status >> 4;
        
        // Note on
        if (command === 9 && velocity > 0) {
            // Start note directly using MIDI note number
            this.startNote(note);
            
            // Try to highlight corresponding key if it exists on virtual keyboard
            const noteName = this.midiNoteToNoteName(note);
            const key = document.querySelector(`[data-note="${noteName}"]`);
            if (key) key.classList.add('active');
        }
        // Note off or note on with velocity 0
        else if (command === 8 || (command === 9 && velocity === 0)) {
            // Stop note directly using MIDI note number
            this.stopNote(note);
            
            // Try to remove highlight if key exists on virtual keyboard
            const noteName = this.midiNoteToNoteName(note);
            const key = document.querySelector(`[data-note="${noteName}"]`);
            if (key) key.classList.remove('active');
        }
    }

    startNote(note) {
        // Convert note to string for Map key if it's a number (MIDI note)
        const noteKey = note.toString();
        if (this.activeNotes.has(noteKey)) return;

        const frequency = this.noteToFrequency(note);
        const osc1Settings = {
            waveType: document.getElementById('osc1-wave').value,
            octave: parseInt(document.getElementById('osc1-octave').value),
            detune: parseInt(document.getElementById('osc1-detune').value)
        };
        
        const osc2Settings = {
            waveType: document.getElementById('osc2-wave').value,
            octave: parseInt(document.getElementById('osc2-octave').value),
            detune: parseInt(document.getElementById('osc2-detune').value)
        };

        const osc3Settings = {
            waveType: document.getElementById('osc3-wave').value,
            octave: parseInt(document.getElementById('osc3-octave').value),
            detune: parseInt(document.getElementById('osc3-detune').value)
        };

        const osc4Settings = {
            waveType: document.getElementById('osc4-wave').value,
            octave: parseInt(document.getElementById('osc4-octave').value),
            detune: parseInt(document.getElementById('osc4-detune').value)
        };

        const oscillator1 = this.createOscillator(frequency, osc1Settings, this.osc1Level);
        const oscillator2 = this.createOscillator(frequency, osc2Settings, this.osc2Level);
        const oscillator3 = this.createOscillator(frequency, osc3Settings, this.osc3Level);
        const oscillator4 = this.createOscillator(frequency, osc4Settings, this.osc4Level);

        oscillator1.oscillator.start();
        oscillator2.oscillator.start();
        oscillator3.oscillator.start();
        oscillator4.oscillator.start();

        // Apply amplitude envelopes
        this.applyAmplitudeEnvelope(oscillator1.gainNode, oscillator1.baseLevel, true);
        this.applyAmplitudeEnvelope(oscillator2.gainNode, oscillator2.baseLevel, true);
        this.applyAmplitudeEnvelope(oscillator3.gainNode, oscillator3.baseLevel, true);
        this.applyAmplitudeEnvelope(oscillator4.gainNode, oscillator4.baseLevel, true);

        // Apply filter envelope
        this.applyFilterEnvelope(true);

        // Connect to LFO if needed
        if (this.lfo.target) {
            switch (this.lfo.target) {
                case 'osc1-level':
                    this.connectToLfo(oscillator1.gainNode.gain);
                    break;
                case 'osc2-level':
                    this.connectToLfo(oscillator2.gainNode.gain);
                    break;
                case 'osc3-level':
                    this.connectToLfo(oscillator3.gainNode.gain);
                    break;
                case 'osc4-level':
                    this.connectToLfo(oscillator4.gainNode.gain);
                    break;
                case 'osc1-detune':
                    this.connectToLfo(oscillator1.oscillator.detune);
                    break;
                case 'osc2-detune':
                    this.connectToLfo(oscillator2.oscillator.detune);
                    break;
                case 'osc3-detune':
                    this.connectToLfo(oscillator3.oscillator.detune);
                    break;
                case 'osc4-detune':
                    this.connectToLfo(oscillator4.oscillator.detune);
                    break;
            }
        }

        this.activeNotes.set(noteKey, [oscillator1, oscillator2, oscillator3, oscillator4]);
    }

    stopNote(note) {
        // Convert note to string for Map key if it's a number (MIDI note)
        const noteKey = note.toString();
        if (!this.activeNotes.has(noteKey)) return;

        const oscillators = this.activeNotes.get(noteKey);
        oscillators.forEach(osc => {
            this.applyAmplitudeEnvelope(osc.gainNode, osc.baseLevel, false);
            // Schedule oscillator stop after release
            osc.oscillator.stop(this.audioContext.currentTime + this.envelope.release / 1000);
            setTimeout(() => {
                osc.gainNode.disconnect();
            }, this.envelope.release);
        });

        // Apply filter envelope release if this was the last note
        if (this.activeNotes.size === 1) { // Current note is the only one
            this.applyFilterEnvelope(false);
        }
        
        this.activeNotes.delete(noteKey);
    }

    setupEventListeners() {
        // Ensure AudioContext is resumed on first user interaction
        document.addEventListener('mousedown', () => {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        }, { once: true });

        // Keyboard interaction
        const keys = document.querySelectorAll('.key');
        keys.forEach(key => {
            key.addEventListener('mousedown', () => {
                const note = key.dataset.note;
                if (note) {
                    this.startNote(note);
                    key.classList.add('active');
                }
            });

            key.addEventListener('mouseup', () => {
                const note = key.dataset.note;
                if (note) {
                    this.stopNote(note);
                    key.classList.remove('active');
                }
            });

            key.addEventListener('mouseleave', () => {
                const note = key.dataset.note;
                if (note && key.classList.contains('active')) {
                    this.stopNote(note);
                    key.classList.remove('active');
                }
            });
        });

        const getKeyMap = () => {
            const startOctave = 4 + this.baseOctave;
            
            // Direct mapping with octave numbers
            return {
                // Lower octave
                'a': `C${startOctave}`,
                'w': `C#${startOctave}`,
                's': `D${startOctave}`,
                'e': `D#${startOctave}`,
                'd': `E${startOctave}`,
                'f': `F${startOctave}`,
                't': `F#${startOctave}`,
                'g': `G${startOctave}`,
                'y': `G#${startOctave}`,
                'h': `A${startOctave}`,
                'u': `A#${startOctave}`,
                'j': `B${startOctave}`,
                // Upper half octave
                'k': `C${startOctave + 1}`,
                'o': `C#${startOctave + 1}`,
                'l': `D${startOctave + 1}`,
                'p': `D#${startOctave + 1}`,
                ';': `E${startOctave + 1}`,
                "'": `F${startOctave + 1}`
            };
        };

        document.addEventListener('keydown', (e) => {
            const keyMap = getKeyMap();
            if (!e.repeat && keyMap[e.key]) {
                const note = keyMap[e.key];
                const key = document.querySelector(`[data-note="${note}"]`);
                if (key) {
                    this.startNote(note);
                    key.classList.add('active');
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            const keyMap = getKeyMap();
            if (keyMap[e.key]) {
                const note = keyMap[e.key];
                const key = document.querySelector(`[data-note="${note}"]`);
                if (key) {
                    this.stopNote(note);
                    key.classList.remove('active');
                }
            }
        });

        // Control changes
        const updateValue = (element) => {
            const valueDisplay = element.parentElement.querySelector('.value');
            if (valueDisplay) {
                valueDisplay.textContent = element.value;
            }
        };

        document.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                updateValue(e.target);
            });

            // Initialize value displays
            updateValue(input);
        });

        // Filter type control
        document.getElementById('filter-type').addEventListener('change', (e) => {
            const newType = e.target.value;
            
            // Disconnect all active notes from current filter
            this.activeNotes.forEach(oscillators => {
                oscillators.forEach(osc => {
                    osc.gainNode.disconnect();
                });
            });

            // Update current filter and reconnect
            switch (newType) {
                case 'lowpass6':
                    this.currentFilter = this.filters.lowpass6;
                    break;
                case 'lowpass12':
                    this.currentFilter = this.filters.lowpass12;
                    break;
                case 'lowpass24':
                    this.currentFilter = this.filters.lowpass24[0];
                    break;
            }
            this.currentFilterType = newType;

            // Reconnect all active notes to new filter
            this.activeNotes.forEach(oscillators => {
                oscillators.forEach(osc => {
                    osc.gainNode.connect(this.currentFilter);
                });
            });
        });

        // Convert linear slider value (0-100) to logarithmic frequency (20-20000 Hz)
        const logFrequency = (value) => {
            const minFreq = Math.log2(20);
            const maxFreq = Math.log2(20000);
            const scale = (maxFreq - minFreq) / 100;
            return Math.pow(2, minFreq + (value * scale));
        };

        // Convert frequency to a human-readable string
        const formatFrequency = (freq) => {
            if (freq >= 1000) {
                return `${(freq/1000).toFixed(1)}kHz`;
            }
            return `${Math.round(freq)}Hz`;
        };

        // Update all filter frequencies when frequency control changes
        document.getElementById('filter-freq').addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            const frequency = logFrequency(value);
            this.filterEnvelope.baseFreq = frequency;
            [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
                filter.frequency.value = frequency;
            });
            // Update display with actual frequency value
            e.target.parentElement.querySelector('.value').textContent = formatFrequency(frequency);
        });

        // Filter envelope controls
        document.getElementById('filter-env-attack').addEventListener('input', (e) => {
            this.filterEnvelope.attack = parseInt(e.target.value);
            updateValue(e.target);
        });

        document.getElementById('filter-env-decay').addEventListener('input', (e) => {
            this.filterEnvelope.decay = parseInt(e.target.value);
            updateValue(e.target);
        });

        document.getElementById('filter-env-sustain').addEventListener('input', (e) => {
            this.filterEnvelope.sustain = parseInt(e.target.value) / 100;
            updateValue(e.target);
            // Update currently held notes
            if (this.activeNotes.size > 0) {
                this.applyFilterEnvelope(true);
            }
        });

        document.getElementById('filter-env-release').addEventListener('input', (e) => {
            this.filterEnvelope.release = parseInt(e.target.value);
            updateValue(e.target);
        });

        document.getElementById('filter-env-amount').addEventListener('input', (e) => {
            this.filterEnvelope.amount = parseInt(e.target.value) / 100;
            updateValue(e.target);
            // Update currently held notes
            if (this.activeNotes.size > 0) {
                this.applyFilterEnvelope(true);
            }
        });

        // Update Q value for current filter type
        document.getElementById('filter-q').addEventListener('input', (e) => {
            const q = parseFloat(e.target.value);
            switch (this.currentFilterType) {
                case 'lowpass6':
                    this.filters.lowpass6.Q.value = q;
                    break;
                case 'lowpass12':
                    this.filters.lowpass12.Q.value = Math.max(0.707, q);
                    break;
                case 'lowpass24':
                    this.filters.lowpass24[0].Q.value = Math.max(0.54, q * 0.5);
                    this.filters.lowpass24[1].Q.value = Math.max(1.31, q);
                    break;
            }
            updateValue(e.target);
        });

        // Octave shift controls
        document.getElementById('octave-down').addEventListener('click', () => {
            this.shiftOctave(-1);
        });

        document.getElementById('octave-up').addEventListener('click', () => {
            this.shiftOctave(1);
        });

        // Normalization controls
        document.getElementById('normalization-type').addEventListener('change', (e) => {
            this.normalizationType = e.target.value;
            this.updateMasterGain();
        });

        document.getElementById('voice-scaling').addEventListener('input', (e) => {
            this.voiceScaling = parseInt(e.target.value);
            e.target.parentElement.querySelector('.value').textContent = (this.voiceScaling / 100).toFixed(2);
            this.updateMasterGain();
        });

        // Initialize octave display
        this.updateOctaveDisplay();

        // Method to connect new oscillator to LFO
        this.connectToLfo = (param) => {
            if (this.lfo.target !== 'none') {
                this.lfo.gain.connect(param);
                this.lfo.targetParams.add(param);
            }
        };
    }

    generateReverbIR() {
        // Create impulse response buffer
        const sampleRate = this.audioContext.sampleRate;
        const length = Math.floor(sampleRate * 3); // 3 seconds
        const impulseResponse = this.audioContext.createBuffer(2, length, sampleRate);
        
        // Get buffer channels
        const leftChannel = impulseResponse.getChannelData(0);
        const rightChannel = impulseResponse.getChannelData(1);
        
        // Get reverb parameters
        const size = parseInt(document.getElementById('reverb-size').value) / 100;
        const damping = parseInt(document.getElementById('reverb-damping').value) / 100;
        
        // Generate impulse response
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const decay = Math.exp(-t * (1 - size) * 5) * Math.exp(-t * damping * 2);
            
            // Add some stereo width with slightly different decay for left/right
            leftChannel[i] = (Math.random() * 2 - 1) * decay;
            rightChannel[i] = (Math.random() * 2 - 1) * decay;
        }
        
        this.reverb.convolver.buffer = impulseResponse;
    }
}

// Initialize synthesizer when the page loads
window.addEventListener('load', () => {
    window.synth = new Synthesizer();
});
