class LFO {
    constructor(ctx) {
        this.ctx = ctx;

        this.oscillator = ctx.createOscillator();
        this.gainNode = ctx.createGain();
        this._target = 'none';
        this.targetParams = new Set();

        // DC offset for bipolar modulation
        this.offset = ctx.createConstantSource();
        this.offset.offset.value = 1;
        this.offset.start();

        // Depth gain node
        this.depthGain = ctx.createGain();
        this.depthGain.gain.value = 0.5;

        // Connect: oscillator → depthGain → gainNode, offset → gainNode
        this.oscillator.connect(this.depthGain);
        this.depthGain.connect(this.gainNode);
        this.offset.connect(this.gainNode);

        this.oscillator.type = 'sine';
        this.oscillator.frequency.value = 1;
        this.oscillator.start();

        // Deferred accessors (set after construction)
        this._getActiveNotes = null;
        this._getFilterInputNode = null;
    }

    get target() {
        return this._target;
    }

    setVoiceAccessor(fn) {
        this._getActiveNotes = fn;
    }

    setFilterAccessor(fn) {
        this._getFilterInputNode = fn;
    }

    setWaveType(type) {
        this.oscillator.type = type;
    }

    setRate(hz) {
        this.oscillator.frequency.value = hz;
    }

    setTarget(targetId, amount) {
        // Disconnect from all previous targets
        this.gainNode.disconnect();
        // Reconnect offset to keep gain node active
        this.offset.connect(this.gainNode);
        this.targetParams.clear();

        this._target = targetId;

        if (targetId === 'none') {
            this.depthGain.gain.value = 0;
            return;
        }

        const activeNotes = this._getActiveNotes ? this._getActiveNotes() : new Map();
        const filterInputNode = this._getFilterInputNode ? this._getFilterInputNode() : null;

        switch (targetId) {
            case 'filter-freq':
                if (filterInputNode) {
                    const freqSlider = document.getElementById('filter-freq');
                    const freqValue = freqSlider ? parseFloat(freqSlider.value) : 100;
                    const minFreqLog = Math.log2(20);
                    const maxFreqLog = Math.log2(20000);
                    const range = maxFreqLog - minFreqLog;
                    const logValue = minFreqLog + (freqValue / 100) * range;
                    const baseFreq = Math.pow(2, logValue);
                    this.depthGain.gain.value = baseFreq * amount;
                    this.gainNode.connect(filterInputNode.frequency);
                    this.targetParams.add(filterInputNode.frequency);
                }
                break;

            case 'filter-q':
                if (filterInputNode) {
                    this.depthGain.gain.value = 5 * amount;
                    this.gainNode.connect(filterInputNode.Q);
                    this.targetParams.add(filterInputNode.Q);
                }
                break;

            case 'osc1-level':
            case 'osc2-level':
            case 'osc3-level':
            case 'osc4-level': {
                const oscIndex = parseInt(targetId.charAt(3)) - 1;
                this.depthGain.gain.value = 0.5 * amount;
                activeNotes.forEach(oscillators => {
                    if (oscillators[oscIndex] && oscillators[oscIndex].gainNode) {
                        this._connectParam(oscillators[oscIndex].gainNode.gain);
                    }
                });
                break;
            }

            case 'osc1-detune':
            case 'osc2-detune':
            case 'osc3-detune':
            case 'osc4-detune': {
                const detuneOscIndex = parseInt(targetId.charAt(3)) - 1;
                this.depthGain.gain.value = 50 * amount;
                activeNotes.forEach(oscillators => {
                    if (oscillators[detuneOscIndex] && oscillators[detuneOscIndex].oscillator) {
                        this._connectParam(oscillators[detuneOscIndex].oscillator.detune);
                    }
                });
                break;
            }
        }
    }

    connectVoice(oscillators, oscIndex) {
        if (this._target === 'none') return;

        const targetBase = `osc${oscIndex + 1}`;
        if (this._target === `${targetBase}-level`) {
            if (oscillators[oscIndex] && oscillators[oscIndex].gainNode) {
                this._connectParam(oscillators[oscIndex].gainNode.gain);
            }
        } else if (this._target === `${targetBase}-detune`) {
            if (oscillators[oscIndex] && oscillators[oscIndex].oscillator) {
                this._connectParam(oscillators[oscIndex].oscillator.detune);
            }
        }
    }

    _connectParam(param) {
        if (this._target !== 'none' && param) {
            this.gainNode.connect(param);
            this.targetParams.add(param);
        }
    }
}
