class Synthesizer {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.activeNotes = new Map();
        // Removed: this.midiAccess = null;
        // Removed: this.initMIDI(); // Will be called by InputController

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
        this.voiceScaling = 75; // Keep as integer 0-100 for slider

        // Calculate total gain and apply dynamic compression
        this.updateMasterGain = () => {
            // Get current oscillator levels and number of active notes
            const totalLinearGain = this.osc1Level + this.osc2Level + this.osc3Level + this.osc4Level;
            const activeNoteCount = Math.max(1, this.activeNotes.size);

            if (this.normalizationType === 'logarithmic') {
                // Apply logarithmic gain reduction with adjustable voice scaling
                const scaleFactor = Math.max(1, Math.pow(activeNoteCount, this.voiceScaling / 100)); // Use voiceScaling/100 here
                const logGain = Math.log10(1 + totalLinearGain * scaleFactor) / Math.log10(2);

                // Additional safety headroom (-12dB)
                this.masterGain.gain.value = 0.25 / Math.max(1, logGain);
            } else {
                // Linear gain reduction with adjustable voice scaling
                this.masterGain.gain.value = 0.5 / Math.max(1, Math.pow(activeNoteCount, this.voiceScaling / 100)); // Use voiceScaling/100 here
            }

            // Scale master level to prevent clipping
            const masterLevelSlider = document.getElementById('master-level');
            const masterLevelValue = masterLevelSlider ? parseInt(masterLevelSlider.value) / 100 : 1.0;
            const masterLevelScaling = 0.7; // -3dB safety margin
            this.masterLevel.gain.value = masterLevelValue * masterLevelScaling;
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
            const db = 20 * Math.log10(rms || 0.00001); // Avoid log10(0)

            // Map dB to height percentage (-60dB to 0dB)
            const height = Math.max(0, Math.min(100, (db + 60) * (100 / 60))); // More accurate scaling

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
            release: 500
        };

        // Filter envelope parameters
        this.filterEnvelope = {
            attack: 100,
            decay: 200,
            sustain: 0.7,
            release: 500,
            amount: 0.5, // 0-1 range for modulation amount
            baseFreq: 20000 // Store base frequency separate from modulated value
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
        this.lfo.depthGain.gain.value = 0.5; // Initial depth

        // Connect for bipolar modulation
        this.lfo.oscillator.connect(this.lfo.depthGain);
        this.lfo.depthGain.connect(this.lfo.gain);
        this.lfo.offset.connect(this.lfo.gain); // LFO + Offset -> Gain

        this.lfo.oscillator.start();

        // Removed: Keyboard octave shift this.baseOctave = 0;

        // Initialize master gain based on default oscillator levels
        this.updateMasterGain();

        // Add master level control (moved inside setupEventListeners)

        // Method to update LFO target (Moved BEFORE setupEventListeners)
        this.updateLfoTarget = (targetId) => {
            // Disconnect from all previous targets
            this.lfo.gain.disconnect();
            // Reconnect the offset source to ensure the gain node remains active
            this.lfo.offset.connect(this.lfo.gain);
            this.lfo.targetParams.clear();

            this.lfo.target = targetId;

            if (targetId === 'none') {
                 this.lfo.depthGain.gain.value = 0; // Set depth to 0 when target is none
                 return;
            }

            // Get amount from slider
            const amountSlider = document.getElementById('lfo-amount');
            const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5; // Default if slider not found

            // Update modulation depth based on target type
            switch (targetId) {
                case 'filter-freq':
                    const freqSlider = document.getElementById('filter-freq');
                    const freqValue = freqSlider ? parseFloat(freqSlider.value) : 100; // Default max freq
                    const baseFreq = this.logFrequency(freqValue); // Use helper
                    this.lfo.depthGain.gain.value = baseFreq * amount; // Modulate around base frequency
                    this.lfo.gain.connect(this.currentFilter.frequency);
                    this.lfo.targetParams.add(this.currentFilter.frequency);
                    break;

                case 'filter-q':
                    this.lfo.depthGain.gain.value = 5 * amount; // Modulate Q by +/- 5
                    this.lfo.gain.connect(this.currentFilter.Q);
                    this.lfo.targetParams.add(this.currentFilter.Q);
                    break;

                case 'osc1-level':
                case 'osc2-level':
                case 'osc3-level':
                case 'osc4-level':
                    const oscIndex = parseInt(targetId.charAt(3)) - 1;
                    this.lfo.depthGain.gain.value = 0.5 * amount; // Modulate gain by +/- 0.5
                    this.activeNotes.forEach(oscillators => {
                        if (oscillators[oscIndex] && oscillators[oscIndex].gainNode) {
                            this.connectToLfo(oscillators[oscIndex].gainNode.gain);
                        }
                    });
                    break;

                case 'osc1-detune':
                case 'osc2-detune':
                case 'osc3-detune':
                case 'osc4-detune':
                    const detuneOscIndex = parseInt(targetId.charAt(3)) - 1;
                    this.lfo.depthGain.gain.value = 50 * amount; // Modulate detune by +/- 50 cents
                    this.activeNotes.forEach(oscillators => {
                         if (oscillators[detuneOscIndex] && oscillators[detuneOscIndex].oscillator) {
                            this.connectToLfo(oscillators[detuneOscIndex].oscillator.detune);
                         }
                    });
                    break;
            }
        };

        // Setup UI event listeners (excluding keyboard/MIDI which are now in InputController)
        this.setupEventListeners();

        // Instantiate Input Controller and initialize it
        this.inputController = new InputController(this);
        this.inputController.initializeInputs(); // This now handles MIDI init and keyboard listeners
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
            const db = 20 * Math.log10(rms || 0.00001); // Avoid log10(0)

            // Map dB to height percentage (-60dB to 0dB)
            const height = Math.max(0, Math.min(100, (db + 60) * (100 / 60))); // More accurate scaling

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

    // Removed: updateOctaveDisplay() - Handled by InputController
    // Removed: shiftOctave(delta) - Handled by InputController

    createOscillator(frequency, settings, level) {
        const osc = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        osc.type = settings.waveType;
        osc.frequency.value = frequency;
        osc.detune.value = settings.detune;

        // Apply octave shift (relative to base frequency)
        const octaveShift = settings.octave * 12; // settings.octave is -2, -1, 0, 1, 2
        osc.frequency.value *= Math.pow(2, octaveShift / 12);

        osc.connect(gainNode);
        // Connect to the correct filter input based on type
        if (this.currentFilterType === 'lowpass24') {
             gainNode.connect(this.filters.lowpass24[0]); // Connect to the first filter in the chain
        } else {
             gainNode.connect(this.currentFilter);
        }

        gainNode.gain.value = 0; // Start silent

        return { oscillator: osc, gainNode, baseLevel: level };
    }

    applyAmplitudeEnvelope(gainNode, baseLevel, isNoteOn) {
        const now = this.audioContext.currentTime;
        const gain = gainNode.gain;
        gain.cancelScheduledValues(now);

        if (isNoteOn) {
            // Attack
            gain.setValueAtTime(gain.value, now); // Start from current value for smoother transitions if retriggered
            gain.linearRampToValueAtTime(baseLevel, now + this.envelope.attack / 1000);

            // Decay and Sustain
            gain.linearRampToValueAtTime(
                baseLevel * this.envelope.sustain,
                now + (this.envelope.attack + this.envelope.decay) / 1000
            );
        } else {
            // Release - using exponential decay for more natural sound
            const currentValue = gain.value;
            gain.setValueAtTime(currentValue, now);
            // Exponential ramp can't go to 0, so we use a very small value
            gain.exponentialRampToValueAtTime(0.00001, now + this.envelope.release / 1000);
            // Then we set it to 0 immediately after to ensure silence
            gain.setValueAtTime(0, now + this.envelope.release / 1000 + 0.001); // Slightly after ramp ends
        }
    }

    noteToFrequency(note) {
        if (typeof note === 'number') {
            // MIDI note number to frequency
            return 440 * Math.pow(2, (note - 69) / 12);
        } else if (typeof note === 'string') {
            // Note name to frequency (e.g. "C4")
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const noteName = note.slice(0, -1).toUpperCase();
            const octaveStr = note.slice(note.search(/\d/)); // Get digits at the end
            const octave = parseInt(octaveStr);
            const noteIndex = notes.indexOf(noteName);

            if (noteIndex === -1 || isNaN(octave)) {
                console.warn(`Invalid note format: ${note}`);
                return 440; // Default to A4 if format is invalid
            }
            // MIDI note number = (octave + 1) * 12 + noteIndex
            const midiNote = (octave + 1) * 12 + noteIndex;
            return 440 * Math.pow(2, (midiNote - 69) / 12);

        } else {
             console.warn(`Invalid note type: ${typeof note}`);
             return 440; // Default A4
        }
    }

    // Removed: midiNoteToNoteName(midiNote) - Handled by InputController
    // Removed: updateMIDIStatus() - Handled by InputController
    // Removed: async initMIDI() - Handled by InputController
    // Removed: handleMIDIMessage(message) - Handled by InputController

    startNote(note) {
        // Ensure AudioContext is running
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        // Convert note to string for Map key if it's a number (MIDI note)
        const noteKey = note.toString();
        if (this.activeNotes.has(noteKey)) return; // Note already playing

        const frequency = this.noteToFrequency(note);
        if (!frequency) return; // Invalid note

        const getSetting = (id, type = 'value', defaultValue = 0) => {
            const element = document.getElementById(id);
            if (!element) return defaultValue;
            return type === 'value' ? element.value : parseInt(element.value) || defaultValue;
        };

        const osc1Settings = {
            waveType: getSetting('osc1-wave', 'value', 'sine'),
            octave: getSetting('osc1-octave', 'int', 0),
            detune: getSetting('osc1-detune', 'int', 0)
        };
        const osc2Settings = {
            waveType: getSetting('osc2-wave', 'value', 'sine'),
            octave: getSetting('osc2-octave', 'int', 0),
            detune: getSetting('osc2-detune', 'int', 0)
        };
        const osc3Settings = {
            waveType: getSetting('osc3-wave', 'value', 'sine'),
            octave: getSetting('osc3-octave', 'int', 0),
            detune: getSetting('osc3-detune', 'int', 0)
        };
        const osc4Settings = {
            waveType: getSetting('osc4-wave', 'value', 'sine'),
            octave: getSetting('osc4-octave', 'int', 0),
            detune: getSetting('osc4-detune', 'int', 0)
        };

        const oscillator1 = this.createOscillator(frequency, osc1Settings, this.osc1Level);
        const oscillator2 = this.createOscillator(frequency, osc2Settings, this.osc2Level);
        const oscillator3 = this.createOscillator(frequency, osc3Settings, this.osc3Level);
        const oscillator4 = this.createOscillator(frequency, osc4Settings, this.osc4Level);

        const oscillators = [oscillator1, oscillator2, oscillator3, oscillator4];
        this.activeNotes.set(noteKey, oscillators);

        oscillators.forEach(osc => {
            osc.oscillator.start();
            this.applyAmplitudeEnvelope(osc.gainNode, osc.baseLevel, true);

            // Connect to LFO if needed (check target and connect)
            const targetBase = `osc${oscillators.indexOf(osc) + 1}`;
            if (this.lfo.target === `${targetBase}-level`) {
                this.connectToLfo(osc.gainNode.gain);
            } else if (this.lfo.target === `${targetBase}-detune`) {
                this.connectToLfo(osc.oscillator.detune);
            }
        });

        // Apply filter envelope
        this.applyFilterEnvelope(true);

        // Update master gain after adding a note
        this.updateMasterGain();
    }

    stopNote(note) {
        // Convert note to string for Map key if it's a number (MIDI note)
        const noteKey = note.toString();
        if (!this.activeNotes.has(noteKey)) return;

        const oscillators = this.activeNotes.get(noteKey);
        const releaseTime = this.envelope.release / 1000;
        const now = this.audioContext.currentTime;

        oscillators.forEach(osc => {
            if (osc && osc.gainNode && osc.oscillator) {
                this.applyAmplitudeEnvelope(osc.gainNode, osc.baseLevel, false);
                // Schedule oscillator stop slightly after the envelope release finishes
                try {
                     osc.oscillator.stop(now + releaseTime + 0.05); // Add small buffer
                } catch (e) {
                    // Oscillator might have already been stopped or scheduled to stop
                    // console.warn("Could not stop oscillator:", e);
                }
                // Disconnect gain node after release to free resources
                setTimeout(() => {
                    if (osc.gainNode) osc.gainNode.disconnect();
                }, (releaseTime + 0.1) * 1000); // Disconnect slightly after stop time
            }
        });

        this.activeNotes.delete(noteKey);

        // Apply filter envelope release only if this was the last note playing
        if (this.activeNotes.size === 0) {
            this.applyFilterEnvelope(false);
        }

        // Update master gain after removing a note
        this.updateMasterGain();
    }

    setupEventListeners() {
        // Ensure AudioContext is resumed on first user interaction (mouse or key)
        const resumeAudio = () => {
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                     console.log("AudioContext resumed.");
                }).catch(err => console.error("AudioContext resume failed:", err));
            }
             // Remove listeners after first interaction
             document.removeEventListener('mousedown', resumeAudio);
             document.removeEventListener('keydown', resumeAudio);
        };
        document.addEventListener('mousedown', resumeAudio, { once: true });
        document.addEventListener('keydown', resumeAudio, { once: true });


        // --- Removed Keyboard interaction listeners (handled by InputController) ---
        // --- Removed getKeyMap() (handled by InputController) ---
        // --- Removed keydown/keyup listeners (handled by InputController) ---

        // Control changes - Helper to update value displays
        const updateValueDisplay = (element) => {
            const valueDisplay = element.parentElement?.querySelector('.value');
            if (!valueDisplay) return;

            let value = element.value;
            let unit = '';
            switch (element.id) {
                case 'env-attack':
                case 'env-decay':
                case 'env-release':
                case 'filter-env-attack':
                case 'filter-env-decay':
                case 'filter-env-release':
                case 'delay-time':
                    unit = 'ms';
                    break;
                case 'env-sustain':
                case 'filter-env-sustain':
                case 'filter-env-amount':
                case 'osc1-level':
                case 'osc2-level':
                case 'osc3-level':
                case 'osc4-level':
                case 'delay-feedback':
                case 'delay-mix':
                case 'reverb-size':
                case 'reverb-damping':
                case 'reverb-mix':
                case 'lfo-amount':
                case 'master-level':
                    unit = '%';
                    value = `${parseInt(value)}`; // Show percentage as integer
                    break;
                case 'osc1-detune':
                case 'osc2-detune':
                case 'osc3-detune':
                case 'osc4-detune':
                    unit = ' cents';
                    break;
                case 'lfo-rate':
                    unit = 'Hz';
                    value = parseFloat(value).toFixed(2); // Show Hz with 2 decimals
                    break;
                case 'filter-freq':
                     const freq = this.logFrequency(parseFloat(value));
                     value = this.formatFrequency(freq); // Display formatted frequency
                     unit = ''; // Unit is included in formatted value
                     break;
                 case 'filter-q':
                     value = parseFloat(value).toFixed(2); // Show Q with 2 decimals
                     unit = '';
                     break;
                 case 'voice-scaling':
                     value = (parseInt(value) / 100).toFixed(2); // Show scaling factor
                     unit = '';
                     break;
                default:
                    unit = '';
            }
            valueDisplay.textContent = `${value}${unit}`;
        };

        // Attach listener to all range inputs
        document.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                updateValueDisplay(e.target);
                // Specific actions based on ID are handled by dedicated listeners below
            });
            // Initialize value displays on load
            updateValueDisplay(input);
        });

         // Master Level
         const masterLevelSlider = document.getElementById('master-level');
         if (masterLevelSlider) {
             masterLevelSlider.addEventListener('input', (e) => {
                 this.updateMasterGain(); // Master gain depends on this value
                 updateValueDisplay(e.target); // Update display
             });
             updateValueDisplay(masterLevelSlider); // Initial display
         }


        // Filter Type Change
        const filterTypeSelect = document.getElementById('filter-type');
        if (filterTypeSelect) {
            filterTypeSelect.addEventListener('change', (e) => {
                const newType = e.target.value;

                // Disconnect all active notes from the *input* of the current filter chain
                this.activeNotes.forEach(oscillators => {
                    oscillators.forEach(osc => {
                        if (osc.gainNode) osc.gainNode.disconnect();
                    });
                });

                // Update current filter reference and type
                switch (newType) {
                    case 'lowpass6':
                        this.currentFilter = this.filters.lowpass6;
                        break;
                    case 'lowpass12':
                        this.currentFilter = this.filters.lowpass12;
                        break;
                    case 'lowpass24':
                        // For multi-pole, currentFilter points to the *input* of the chain
                        this.currentFilter = this.filters.lowpass24[0];
                        break;
                }
                this.currentFilterType = newType;

                // Reconnect all active notes to the *input* of the new filter chain
                this.activeNotes.forEach(oscillators => {
                    oscillators.forEach(osc => {
                         if (osc.gainNode) osc.gainNode.connect(this.currentFilter);
                    });
                });

                 // Reconnect LFO if targeting filter frequency or Q
                 if (this.lfo.target === 'filter-freq' || this.lfo.target === 'filter-q') {
                     this.updateLfoTarget(this.lfo.target); // Re-apply LFO to the new filter parameter
                 }
            });
        }

        // Filter Frequency
        const filterFreqSlider = document.getElementById('filter-freq');
        if (filterFreqSlider) {
            filterFreqSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const frequency = this.logFrequency(value);
                this.filterEnvelope.baseFreq = frequency; // Store base for envelope

                // Update all filter instances
                [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
                    filter.frequency.value = frequency;
                });
                updateValueDisplay(e.target); // Update display

                 // Re-calculate LFO depth if targeting frequency
                 if (this.lfo.target === 'filter-freq') {
                     this.updateLfoTarget('filter-freq');
                 }
            });
            // Initial update
            const initialFreq = this.logFrequency(parseFloat(filterFreqSlider.value));
            this.filterEnvelope.baseFreq = initialFreq;
             [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
                 filter.frequency.value = initialFreq;
             });
            updateValueDisplay(filterFreqSlider);
        }

        // Filter Q
        const filterQSlider = document.getElementById('filter-q');
        if (filterQSlider) {
            filterQSlider.addEventListener('input', (e) => {
                const q = parseFloat(e.target.value);
                // Apply Q based on the current filter type (respecting typical ranges)
                switch (this.currentFilterType) {
                    case 'lowpass6':
                        this.filters.lowpass6.Q.value = q; // Q has less effect on 6dB
                        break;
                    case 'lowpass12':
                        this.filters.lowpass12.Q.value = q;
                        break;
                    case 'lowpass24':
                        // Apply Q proportionally to the two filters for a combined effect
                        this.filters.lowpass24[0].Q.value = q * 0.54 / 1.0; // Base Q approx 0.54
                        this.filters.lowpass24[1].Q.value = q * 1.31 / 1.0; // Base Q approx 1.31
                        break;
                }
                updateValueDisplay(e.target);

                 // Re-calculate LFO depth if targeting Q
                 if (this.lfo.target === 'filter-q') {
                     this.updateLfoTarget('filter-q');
                 }
            });
             updateValueDisplay(filterQSlider); // Initial display
        }


        // Filter Envelope Controls
        const setupEnvelopeControl = (id, envelopeKey, isPercent = false) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.filterEnvelope[envelopeKey] = isPercent ? value / 100 : value;
                    updateValueDisplay(e.target);
                    // Re-apply envelope to active notes if sustain or amount changes
                    if ((envelopeKey === 'sustain' || envelopeKey === 'amount') && this.activeNotes.size > 0) {
                        this.applyFilterEnvelope(true); // Re-trigger attack/decay/sustain phase
                    }
                });
                 // Initial update
                 const initialValue = parseInt(element.value);
                 this.filterEnvelope[envelopeKey] = isPercent ? initialValue / 100 : initialValue;
                 updateValueDisplay(element);
            }
        };
        setupEnvelopeControl('filter-env-attack', 'attack');
        setupEnvelopeControl('filter-env-decay', 'decay');
        setupEnvelopeControl('filter-env-sustain', 'sustain', true);
        setupEnvelopeControl('filter-env-release', 'release');
        setupEnvelopeControl('filter-env-amount', 'amount', true);


        // --- Removed Octave shift controls (handled by InputController) ---

        // Normalization controls
        const normTypeSelect = document.getElementById('normalization-type');
        if (normTypeSelect) {
            normTypeSelect.addEventListener('change', (e) => {
                this.normalizationType = e.target.value;
                this.updateMasterGain();
            });
            this.normalizationType = normTypeSelect.value; // Initial value
        }

        const voiceScalingSlider = document.getElementById('voice-scaling');
        if (voiceScalingSlider) {
            voiceScalingSlider.addEventListener('input', (e) => {
                this.voiceScaling = parseInt(e.target.value); // Store as 0-100
                updateValueDisplay(e.target);
                this.updateMasterGain();
            });
            this.voiceScaling = parseInt(voiceScalingSlider.value); // Initial value
            updateValueDisplay(voiceScalingSlider); // Initial display
        }

        // --- Removed Initial octave display (handled by InputController) ---

        // Method to connect new oscillator to LFO (called during startNote)
        this.connectToLfo = (param) => {
            if (this.lfo.target !== 'none' && param) {
                this.lfo.gain.connect(param);
                this.lfo.targetParams.add(param); // Track connection
            }
        };

        // Method to apply filter envelope
        this.applyFilterEnvelope = (isNoteOn) => {
            const now = this.audioContext.currentTime;
            const baseFreq = this.filterEnvelope.baseFreq;
            const amount = this.filterEnvelope.amount; // 0 to 1
            const attackTime = this.filterEnvelope.attack / 1000;
            const decayTime = this.filterEnvelope.decay / 1000;
            const sustainLevel = this.filterEnvelope.sustain; // 0 to 1
            const releaseTime = this.filterEnvelope.release / 1000;

            // Calculate target frequencies based on baseFreq and amount
            // Max frequency can go significantly higher, let's use octaves
            const maxFreq = baseFreq * Math.pow(2, amount * 4); // Up to 4 octaves higher
            const sustainFreq = baseFreq * Math.pow(2, amount * sustainLevel * 4);

             // Apply envelope to all relevant filter instances
             const filtersToModulate = [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24];

            filtersToModulate.forEach(filter => {
                 if (!filter || !filter.frequency) return; // Skip if filter doesn't exist

                 const freqParam = filter.frequency;
                 freqParam.cancelScheduledValues(now);

                if (isNoteOn) {
                    // Start from base frequency (or current value if retriggered quickly)
                    freqParam.setValueAtTime(freqParam.value, now);

                    // Attack: Ramp to peak frequency
                    freqParam.linearRampToValueAtTime(maxFreq, now + attackTime);

                    // Decay: Ramp to sustain frequency
                    freqParam.linearRampToValueAtTime(sustainFreq, now + attackTime + decayTime);

                } else { // Note Off (Release phase)
                    // Start release from current frequency value
                    const currentFreq = freqParam.value;
                    freqParam.setValueAtTime(currentFreq, now);
                    // Ramp back down to base frequency
                    // Use linear ramp for potentially faster/more predictable release than exponential
                    freqParam.linearRampToValueAtTime(baseFreq, now + releaseTime);
                }
            });
        };

        // Mixer level controls
        const setupMixerControl = (id, levelKey) => {
             const element = document.getElementById(id);
             if (element) {
                 element.addEventListener('input', (e) => {
                     const level = parseInt(e.target.value) / 100;
                     this[levelKey] = level;
                     this.updateMasterGain(); // Recalculate master gain
                     updateValueDisplay(e.target);
                     // Update gain for active notes using this oscillator
                     const oscIndex = parseInt(id.charAt(3)) - 1;
                     this.activeNotes.forEach(oscillators => {
                         if (oscillators[oscIndex] && oscillators[oscIndex].gainNode) {
                             // Apply envelope logic: sustain level should be relative to new base level
                             const currentEnvSustain = this.envelope.sustain;
                             oscillators[oscIndex].baseLevel = level; // Update base level reference
                             // Adjust current gain based on sustain level if note is in sustain phase
                             // This is tricky, might be better to just set baseLevel and let envelope handle it
                             // For simplicity, let's just update the baseLevel used by the envelope
                         }
                     });
                 });
                 // Initial update
                 this[levelKey] = parseInt(element.value) / 100;
                 updateValueDisplay(element);
             }
        };
        setupMixerControl('osc1-level', 'osc1Level');
        setupMixerControl('osc2-level', 'osc2Level');
        setupMixerControl('osc3-level', 'osc3Level');
        setupMixerControl('osc4-level', 'osc4Level');


        // Amplitude Envelope controls
        const setupAmpEnvelopeControl = (id, envelopeKey, isPercent = false) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.envelope[envelopeKey] = isPercent ? value / 100 : value;
                    updateValueDisplay(e.target);
                     // If sustain changes, update active notes in sustain phase
                     if (envelopeKey === 'sustain' && this.activeNotes.size > 0) {
                         const now = this.audioContext.currentTime;
                         this.activeNotes.forEach(oscillators => {
                             oscillators.forEach(osc => {
                                 // Check if note is likely in sustain phase (simplistic check)
                                 const timeSinceAttackDecay = now - (osc.startTime || 0) - (this.envelope.attack + this.envelope.decay) / 1000;
                                 if (timeSinceAttackDecay > 0 && osc.gainNode) {
                                     // Ramp to new sustain level from current value
                                     osc.gainNode.gain.cancelScheduledValues(now);
                                     osc.gainNode.gain.setValueAtTime(osc.gainNode.gain.value, now);
                                     osc.gainNode.gain.linearRampToValueAtTime(osc.baseLevel * this.envelope.sustain, now + 0.01); // Quick ramp
                                 }
                             });
                         });
                     }
                });
                 // Initial update
                 const initialValue = parseInt(element.value);
                 this.envelope[envelopeKey] = isPercent ? initialValue / 100 : initialValue;
                 updateValueDisplay(element);
            }
        };
        setupAmpEnvelopeControl('env-attack', 'attack');
        setupAmpEnvelopeControl('env-decay', 'decay');
        setupAmpEnvelopeControl('env-sustain', 'sustain', true);
        setupAmpEnvelopeControl('env-release', 'release');


        // LFO controls
        const lfoTargetSelect = document.getElementById('lfo-target');
        if (lfoTargetSelect) {
            lfoTargetSelect.addEventListener('change', (e) => {
                this.updateLfoTarget(e.target.value);
            });
            this.updateLfoTarget(lfoTargetSelect.value); // Initial call
        }

        const lfoWaveSelect = document.getElementById('lfo-wave');
        if (lfoWaveSelect) {
            lfoWaveSelect.addEventListener('change', (e) => {
                this.lfo.oscillator.type = e.target.value;
            });
             this.lfo.oscillator.type = lfoWaveSelect.value; // Initial value
        }

        const lfoRateSlider = document.getElementById('lfo-rate');
        if (lfoRateSlider) {
            lfoRateSlider.addEventListener('input', (e) => {
                this.lfo.oscillator.frequency.value = parseFloat(e.target.value);
                updateValueDisplay(e.target);
            });
             this.lfo.oscillator.frequency.value = parseFloat(lfoRateSlider.value); // Initial value
             updateValueDisplay(lfoRateSlider); // Initial display
        }

        const lfoAmountSlider = document.getElementById('lfo-amount');
        if (lfoAmountSlider) {
            lfoAmountSlider.addEventListener('input', (e) => {
                // Re-calculate depth and re-apply target connections
                this.updateLfoTarget(this.lfo.target);
                updateValueDisplay(e.target);
            });
             updateValueDisplay(lfoAmountSlider); // Initial display
        }


        // Effects controls
        const setupEffectControl = (id, effectObj, param, isPercent = false, isTime = false) => {
             const element = document.getElementById(id);
             if (element) {
                 element.addEventListener('input', (e) => {
                     let value = isPercent ? parseInt(e.target.value) / 100 : parseFloat(e.target.value);
                     if (isTime) value /= 1000; // Convert ms to seconds

                     if (param.includes('.')) { // Handle nested properties like gain.value
                         const parts = param.split('.');
                         effectObj[parts[0]][parts[1]].value = value;
                     } else {
                         effectObj[param].value = value;
                     }
                     updateValueDisplay(e.target);

                     // Special handling for reverb regeneration
                     if (id.startsWith('reverb-') && (param === 'size' || param === 'damping')) {
                         this.generateReverbIR();
                     }
                 });
                  // Initial update
                  let initialValue = isPercent ? parseInt(element.value) / 100 : parseFloat(element.value);
                  if (isTime) initialValue /= 1000;
                  if (param.includes('.')) {
                      const parts = param.split('.');
                      effectObj[parts[0]][parts[1]].value = initialValue;
                  } else {
                      effectObj[param].value = initialValue;
                  }
                  updateValueDisplay(element);
             }
        };

        setupEffectControl('delay-time', this.delay, 'delayNode.delayTime', false, true);
        setupEffectControl('delay-feedback', this.delay, 'feedback.gain', true);
        setupEffectControl('delay-mix', this.delay, 'mix.gain', true);

        // Reverb controls need special handling as they trigger regeneration
        const reverbSizeSlider = document.getElementById('reverb-size');
        if (reverbSizeSlider) {
            reverbSizeSlider.addEventListener('input', (e) => {
                 updateValueDisplay(e.target);
                 this.generateReverbIR(); // Regenerate IR on size change
            });
             updateValueDisplay(reverbSizeSlider);
        }
        const reverbDampingSlider = document.getElementById('reverb-damping');
        if (reverbDampingSlider) {
            reverbDampingSlider.addEventListener('input', (e) => {
                 updateValueDisplay(e.target);
                 this.generateReverbIR(); // Regenerate IR on damping change
            });
             updateValueDisplay(reverbDampingSlider);
        }
        setupEffectControl('reverb-mix', this.reverb, 'mix.gain', true);

    }

    // Helper: Convert linear slider value (0-100) to logarithmic frequency (20-20000 Hz)
    logFrequency(value) {
        const minFreqLog = Math.log2(20);
        const maxFreqLog = Math.log2(20000);
        const range = maxFreqLog - minFreqLog;
        const logValue = minFreqLog + (value / 100) * range;
        return Math.pow(2, logValue);
    }

    // Helper: Convert frequency to a human-readable string
    formatFrequency(freq) {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(1)}kHz`;
        }
        return `${Math.round(freq)}Hz`;
    }


    generateReverbIR() {
        // Create impulse response buffer
        const sampleRate = this.audioContext.sampleRate;
        const sizeSlider = document.getElementById('reverb-size');
        const dampingSlider = document.getElementById('reverb-damping');

        // Use defaults if sliders not found
        const size = sizeSlider ? parseInt(sizeSlider.value) / 100 : 0.5; // 0 to 1
        const damping = dampingSlider ? parseInt(dampingSlider.value) / 100 : 0.5; // 0 to 1

        // Adjust length based on size (e.g., 0.5s to 4s)
        const lengthSeconds = 0.5 + size * 3.5;
        const length = Math.floor(sampleRate * lengthSeconds);
        if (length <= 0) return; // Avoid creating zero-length buffer

        const impulseResponse = this.audioContext.createBuffer(2, length, sampleRate);

        // Get buffer channels
        const leftChannel = impulseResponse.getChannelData(0);
        const rightChannel = impulseResponse.getChannelData(1);

        // Generate impulse response using a simple decaying noise model
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            // Exponential decay influenced by size (longer decay for larger size)
            // Damping affects high frequencies more (simplified here by applying to overall decay)
            const decayFactor = Math.pow(1 - damping, t * 10); // Damping effect
            const sizeDecay = Math.exp(-t / (lengthSeconds * 0.3)); // Size controls overall length

            const envelope = sizeDecay * decayFactor;

            // Stereo noise
            leftChannel[i] = (Math.random() * 2 - 1) * envelope;
            rightChannel[i] = (Math.random() * 2 - 1) * envelope;
        }

        // Normalize (optional, but good practice)
        let max = 0;
        for (let i = 0; i < length; i++) {
            if (Math.abs(leftChannel[i]) > max) max = Math.abs(leftChannel[i]);
            if (Math.abs(rightChannel[i]) > max) max = Math.abs(rightChannel[i]);
        }
        if (max > 0) {
            for (let i = 0; i < length; i++) {
                leftChannel[i] /= max;
                rightChannel[i] /= max;
            }
        }


        this.reverb.convolver.buffer = impulseResponse;
    }
}

// Initialize synthesizer when the page loads
window.addEventListener('load', () => {
    // Create the Synthesizer instance. The InputController is created inside its constructor.
    window.synth = new Synthesizer();
    console.log("Synthesizer initialized.");
});
