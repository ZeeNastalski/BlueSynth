class VoiceManager {
    constructor(ctx, envelopes, filterBank, lfo, mixer) {
        this.ctx = ctx;
        this.envelopes = envelopes;
        this.filterBank = filterBank;
        this.lfo = lfo;
        this.mixer = mixer;
        this.activeNotes = new Map();
    }

    noteToFrequency(note) {
        if (typeof note === 'number') {
            return 440 * Math.pow(2, (note - 69) / 12);
        } else if (typeof note === 'string') {
            const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const noteName = note.slice(0, -1).toUpperCase();
            const octaveStr = note.slice(note.search(/\d/));
            const octave = parseInt(octaveStr);
            const noteIndex = notes.indexOf(noteName);

            if (noteIndex === -1 || isNaN(octave)) {
                console.warn(`Invalid note format: ${note}`);
                return 440;
            }
            const midiNote = (octave + 1) * 12 + noteIndex;
            return 440 * Math.pow(2, (midiNote - 69) / 12);
        } else {
            console.warn(`Invalid note type: ${typeof note}`);
            return 440;
        }
    }

    createOscillator(frequency, settings, level) {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = settings.waveType;
        osc.frequency.value = frequency;
        osc.detune.value = settings.detune;

        const octaveShift = settings.octave * 12;
        osc.frequency.value *= Math.pow(2, octaveShift / 12);

        osc.connect(gainNode);

        // Connect to the current filter input
        gainNode.connect(this.filterBank.inputNode);

        gainNode.gain.value = 0; // Start silent

        return { oscillator: osc, gainNode, baseLevel: level };
    }

    startNote(note) {
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }

        const noteKey = note.toString();
        if (this.activeNotes.has(noteKey)) return;

        const frequency = this.noteToFrequency(note);
        if (!frequency) return;

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

        const oscillator1 = this.createOscillator(frequency, osc1Settings, this.mixer.osc1Level);
        const oscillator2 = this.createOscillator(frequency, osc2Settings, this.mixer.osc2Level);
        const oscillator3 = this.createOscillator(frequency, osc3Settings, this.mixer.osc3Level);
        const oscillator4 = this.createOscillator(frequency, osc4Settings, this.mixer.osc4Level);

        const oscillators = [oscillator1, oscillator2, oscillator3, oscillator4];
        this.activeNotes.set(noteKey, oscillators);

        oscillators.forEach((osc, index) => {
            osc.oscillator.start();
            this.envelopes.applyAmplitudeEnvelope(osc.gainNode, osc.baseLevel, true);
            this.lfo.connectVoice(oscillators, index);
        });

        // Apply filter envelope
        this.envelopes.applyFilterEnvelope(true, this.filterBank.allFilters);

        // Update master gain after adding a note
        this.mixer.updateMasterGain(this.activeNotes.size);
    }

    stopNote(note) {
        const noteKey = note.toString();
        if (!this.activeNotes.has(noteKey)) return;

        const oscillators = this.activeNotes.get(noteKey);
        const releaseTime = this.envelopes.ampEnvelope.release / 1000;
        const now = this.ctx.currentTime;

        oscillators.forEach(osc => {
            if (osc && osc.gainNode && osc.oscillator) {
                this.envelopes.applyAmplitudeEnvelope(osc.gainNode, osc.baseLevel, false);
                try {
                    osc.oscillator.stop(now + releaseTime + 0.05);
                } catch (e) {
                    // Oscillator might have already been stopped
                }
                setTimeout(() => {
                    if (osc.gainNode) osc.gainNode.disconnect();
                }, (releaseTime + 0.1) * 1000);
            }
        });

        this.activeNotes.delete(noteKey);

        // Apply filter envelope release only if last note
        if (this.activeNotes.size === 0) {
            this.envelopes.applyFilterEnvelope(false, this.filterBank.allFilters);
        }

        this.mixer.updateMasterGain(this.activeNotes.size);
    }

    reconnectVoicesToFilter() {
        this.activeNotes.forEach(oscillators => {
            oscillators.forEach(osc => {
                if (osc.gainNode) {
                    osc.gainNode.disconnect();
                    osc.gainNode.connect(this.filterBank.inputNode);
                }
            });
        });
    }
}
