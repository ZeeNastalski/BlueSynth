class UIController {
    constructor(audioEngine, filterBank, lfo, envelopes, effects, mixer, voiceManager) {
        this.audioEngine = audioEngine;
        this.filterBank = filterBank;
        this.lfo = lfo;
        this.envelopes = envelopes;
        this.effects = effects;
        this.mixer = mixer;
        this.voiceManager = voiceManager;
    }

    init() {
        this._setupAudioResume();
        this._setupValueDisplays();
        this._setupMasterLevel();
        this._setupFilterControls();
        this._setupFilterEnvelopeControls();
        this._setupNormalizationControls();
        this._setupMixerLevelControls();
        this._setupAmplitudeEnvelopeControls();
        this._setupLFOControls();
        this._setupEffectsControls();
    }

    _updateValueDisplay(element) {
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
                value = `${parseInt(value)}`;
                break;
            case 'osc1-detune':
            case 'osc2-detune':
            case 'osc3-detune':
            case 'osc4-detune':
                unit = ' cents';
                break;
            case 'lfo-rate':
                unit = 'Hz';
                value = parseFloat(value).toFixed(2);
                break;
            case 'filter-freq': {
                const freq = this.filterBank.logFrequency(parseFloat(value));
                value = this.filterBank.formatFrequency(freq);
                unit = '';
                break;
            }
            case 'filter-q':
                value = parseFloat(value).toFixed(2);
                unit = '';
                break;
            case 'voice-scaling':
                value = (parseInt(value) / 100).toFixed(2);
                unit = '';
                break;
            default:
                unit = '';
        }
        valueDisplay.textContent = `${value}${unit}`;
    }

    _setupAudioResume() {
        const resumeAudio = () => {
            this.audioEngine.resume().then(() => {
                console.log("AudioContext resumed.");
            }).catch(err => console.error("AudioContext resume failed:", err));
            document.removeEventListener('mousedown', resumeAudio);
            document.removeEventListener('keydown', resumeAudio);
        };
        document.addEventListener('mousedown', resumeAudio, { once: true });
        document.addEventListener('keydown', resumeAudio, { once: true });
    }

    _setupValueDisplays() {
        document.querySelectorAll('input[type="range"]').forEach(input => {
            input.addEventListener('input', (e) => {
                this._updateValueDisplay(e.target);
            });
            this._updateValueDisplay(input);
        });
    }

    _setupMasterLevel() {
        const masterLevelSlider = document.getElementById('master-level');
        if (masterLevelSlider) {
            masterLevelSlider.addEventListener('input', (e) => {
                this.mixer.updateMasterGain(this.voiceManager.activeNotes.size);
                this._updateValueDisplay(e.target);
            });
            this._updateValueDisplay(masterLevelSlider);
        }
    }

    _setupFilterControls() {
        // Filter Type Change
        const filterTypeSelect = document.getElementById('filter-type');
        if (filterTypeSelect) {
            filterTypeSelect.addEventListener('change', (e) => {
                // Disconnect all active notes from old filter
                this.voiceManager.activeNotes.forEach(oscillators => {
                    oscillators.forEach(osc => {
                        if (osc.gainNode) osc.gainNode.disconnect();
                    });
                });

                this.filterBank.setType(e.target.value);

                // Reconnect all active notes to new filter
                this.voiceManager.activeNotes.forEach(oscillators => {
                    oscillators.forEach(osc => {
                        if (osc.gainNode) osc.gainNode.connect(this.filterBank.inputNode);
                    });
                });

                // Reconnect LFO if targeting filter
                if (this.lfo.target === 'filter-freq' || this.lfo.target === 'filter-q') {
                    const amountSlider = document.getElementById('lfo-amount');
                    const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5;
                    this.lfo.setTarget(this.lfo.target, amount);
                }
            });
        }

        // Filter Frequency
        const filterFreqSlider = document.getElementById('filter-freq');
        if (filterFreqSlider) {
            filterFreqSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const frequency = this.filterBank.logFrequency(value);
                this.envelopes.filterEnvelope.baseFreq = frequency;
                this.filterBank.setFrequency(frequency);
                this._updateValueDisplay(e.target);

                if (this.lfo.target === 'filter-freq') {
                    const amountSlider = document.getElementById('lfo-amount');
                    const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5;
                    this.lfo.setTarget('filter-freq', amount);
                }
            });
            // Initial update
            const initialFreq = this.filterBank.logFrequency(parseFloat(filterFreqSlider.value));
            this.envelopes.filterEnvelope.baseFreq = initialFreq;
            this.filterBank.setFrequency(initialFreq);
            this._updateValueDisplay(filterFreqSlider);
        }

        // Filter Q
        const filterQSlider = document.getElementById('filter-q');
        if (filterQSlider) {
            filterQSlider.addEventListener('input', (e) => {
                const q = parseFloat(e.target.value);
                this.filterBank.setQ(q);
                this._updateValueDisplay(e.target);

                if (this.lfo.target === 'filter-q') {
                    const amountSlider = document.getElementById('lfo-amount');
                    const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5;
                    this.lfo.setTarget('filter-q', amount);
                }
            });
            this._updateValueDisplay(filterQSlider);
        }
    }

    _setupFilterEnvelopeControls() {
        const setupControl = (id, envelopeKey, isPercent = false) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.envelopes.filterEnvelope[envelopeKey] = isPercent ? value / 100 : value;
                    this._updateValueDisplay(e.target);
                    if ((envelopeKey === 'sustain' || envelopeKey === 'amount') && this.voiceManager.activeNotes.size > 0) {
                        this.envelopes.applyFilterEnvelope(true, this.filterBank.allFilters);
                    }
                });
                const initialValue = parseInt(element.value);
                this.envelopes.filterEnvelope[envelopeKey] = isPercent ? initialValue / 100 : initialValue;
                this._updateValueDisplay(element);
            }
        };
        setupControl('filter-env-attack', 'attack');
        setupControl('filter-env-decay', 'decay');
        setupControl('filter-env-sustain', 'sustain', true);
        setupControl('filter-env-release', 'release');
        setupControl('filter-env-amount', 'amount', true);
    }

    _setupNormalizationControls() {
        const normTypeSelect = document.getElementById('normalization-type');
        if (normTypeSelect) {
            normTypeSelect.addEventListener('change', (e) => {
                this.mixer.normalizationType = e.target.value;
                this.mixer.updateMasterGain(this.voiceManager.activeNotes.size);
            });
            this.mixer.normalizationType = normTypeSelect.value;
        }

        const voiceScalingSlider = document.getElementById('voice-scaling');
        if (voiceScalingSlider) {
            voiceScalingSlider.addEventListener('input', (e) => {
                this.mixer.voiceScaling = parseInt(e.target.value);
                this._updateValueDisplay(e.target);
                this.mixer.updateMasterGain(this.voiceManager.activeNotes.size);
            });
            this.mixer.voiceScaling = parseInt(voiceScalingSlider.value);
            this._updateValueDisplay(voiceScalingSlider);
        }
    }

    _setupMixerLevelControls() {
        const setupControl = (id, levelKey) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const level = parseInt(e.target.value) / 100;
                    this.mixer[levelKey] = level;
                    this.mixer.updateMasterGain(this.voiceManager.activeNotes.size);
                    this._updateValueDisplay(e.target);
                    const oscIndex = parseInt(id.charAt(3)) - 1;
                    this.voiceManager.activeNotes.forEach(oscillators => {
                        if (oscillators[oscIndex] && oscillators[oscIndex].gainNode) {
                            oscillators[oscIndex].baseLevel = level;
                        }
                    });
                });
                this.mixer[levelKey] = parseInt(element.value) / 100;
                this._updateValueDisplay(element);
            }
        };
        setupControl('osc1-level', 'osc1Level');
        setupControl('osc2-level', 'osc2Level');
        setupControl('osc3-level', 'osc3Level');
        setupControl('osc4-level', 'osc4Level');
    }

    _setupAmplitudeEnvelopeControls() {
        const setupControl = (id, envelopeKey, isPercent = false) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    this.envelopes.ampEnvelope[envelopeKey] = isPercent ? value / 100 : value;
                    this._updateValueDisplay(e.target);
                    if (envelopeKey === 'sustain' && this.voiceManager.activeNotes.size > 0) {
                        const now = this.audioEngine.ctx.currentTime;
                        this.voiceManager.activeNotes.forEach(oscillators => {
                            oscillators.forEach(osc => {
                                const timeSinceAttackDecay = now - (osc.startTime || 0) - (this.envelopes.ampEnvelope.attack + this.envelopes.ampEnvelope.decay) / 1000;
                                if (timeSinceAttackDecay > 0 && osc.gainNode) {
                                    osc.gainNode.gain.cancelScheduledValues(now);
                                    osc.gainNode.gain.setValueAtTime(osc.gainNode.gain.value, now);
                                    osc.gainNode.gain.linearRampToValueAtTime(osc.baseLevel * this.envelopes.ampEnvelope.sustain, now + 0.01);
                                }
                            });
                        });
                    }
                });
                const initialValue = parseInt(element.value);
                this.envelopes.ampEnvelope[envelopeKey] = isPercent ? initialValue / 100 : initialValue;
                this._updateValueDisplay(element);
            }
        };
        setupControl('env-attack', 'attack');
        setupControl('env-decay', 'decay');
        setupControl('env-sustain', 'sustain', true);
        setupControl('env-release', 'release');
    }

    _setupLFOControls() {
        const lfoTargetSelect = document.getElementById('lfo-target');
        if (lfoTargetSelect) {
            lfoTargetSelect.addEventListener('change', (e) => {
                const amountSlider = document.getElementById('lfo-amount');
                const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5;
                this.lfo.setTarget(e.target.value, amount);
            });
            const amountSlider = document.getElementById('lfo-amount');
            const amount = amountSlider ? parseInt(amountSlider.value) / 100 : 0.5;
            this.lfo.setTarget(lfoTargetSelect.value, amount);
        }

        const lfoWaveSelect = document.getElementById('lfo-wave');
        if (lfoWaveSelect) {
            lfoWaveSelect.addEventListener('change', (e) => {
                this.lfo.setWaveType(e.target.value);
            });
            this.lfo.setWaveType(lfoWaveSelect.value);
        }

        const lfoRateSlider = document.getElementById('lfo-rate');
        if (lfoRateSlider) {
            lfoRateSlider.addEventListener('input', (e) => {
                this.lfo.setRate(parseFloat(e.target.value));
                this._updateValueDisplay(e.target);
            });
            this.lfo.setRate(parseFloat(lfoRateSlider.value));
            this._updateValueDisplay(lfoRateSlider);
        }

        const lfoAmountSlider = document.getElementById('lfo-amount');
        if (lfoAmountSlider) {
            lfoAmountSlider.addEventListener('input', (e) => {
                const amount = parseInt(e.target.value) / 100;
                this.lfo.setTarget(this.lfo.target, amount);
                this._updateValueDisplay(e.target);
            });
            this._updateValueDisplay(lfoAmountSlider);
        }
    }

    _setupEffectsControls() {
        // Delay controls
        const delayTimeSlider = document.getElementById('delay-time');
        if (delayTimeSlider) {
            delayTimeSlider.addEventListener('input', (e) => {
                this.effects.setDelayTime(parseInt(e.target.value) / 1000);
                this._updateValueDisplay(e.target);
            });
            this.effects.setDelayTime(parseInt(delayTimeSlider.value) / 1000);
            this._updateValueDisplay(delayTimeSlider);
        }

        const delayFeedbackSlider = document.getElementById('delay-feedback');
        if (delayFeedbackSlider) {
            delayFeedbackSlider.addEventListener('input', (e) => {
                this.effects.setDelayFeedback(parseInt(e.target.value) / 100);
                this._updateValueDisplay(e.target);
            });
            this.effects.setDelayFeedback(parseInt(delayFeedbackSlider.value) / 100);
            this._updateValueDisplay(delayFeedbackSlider);
        }

        const delayMixSlider = document.getElementById('delay-mix');
        if (delayMixSlider) {
            delayMixSlider.addEventListener('input', (e) => {
                this.effects.setDelayMix(parseInt(e.target.value) / 100);
                this._updateValueDisplay(e.target);
            });
            this.effects.setDelayMix(parseInt(delayMixSlider.value) / 100);
            this._updateValueDisplay(delayMixSlider);
        }

        // Reverb controls
        const reverbSizeSlider = document.getElementById('reverb-size');
        if (reverbSizeSlider) {
            reverbSizeSlider.addEventListener('input', (e) => {
                this._updateValueDisplay(e.target);
                this.effects.generateReverbIR();
            });
            this._updateValueDisplay(reverbSizeSlider);
        }

        const reverbDampingSlider = document.getElementById('reverb-damping');
        if (reverbDampingSlider) {
            reverbDampingSlider.addEventListener('input', (e) => {
                this._updateValueDisplay(e.target);
                this.effects.generateReverbIR();
            });
            this._updateValueDisplay(reverbDampingSlider);
        }

        const reverbMixSlider = document.getElementById('reverb-mix');
        if (reverbMixSlider) {
            reverbMixSlider.addEventListener('input', (e) => {
                this.effects.setReverbMix(parseInt(e.target.value) / 100);
                this._updateValueDisplay(e.target);
            });
            this.effects.setReverbMix(parseInt(reverbMixSlider.value) / 100);
            this._updateValueDisplay(reverbMixSlider);
        }
    }
}
