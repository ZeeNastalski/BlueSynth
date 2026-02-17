class Arpeggiator {
    constructor(voiceManager) {
        this.voiceManager = voiceManager;
        this.enabled = false;
        this.heldNotes = [];
        this.pattern = 'up';
        this.bpm = 120;
        this.division = '8';
        this.octaveRange = 1;
        this.gate = 50;

        this.currentStep = 0;
        this.direction = 1; // 1 = up, -1 = down (for up-down/down-up patterns)
        this.intervalId = null;
        this.gateTimeoutId = null;
        this.currentArpNote = null;
        this.sequence = [];
    }

    // --- Proxy interface (matches VoiceManager) ---

    startNote(note) {
        if (!this.enabled) {
            this.voiceManager.startNote(note);
            return;
        }

        var noteStr = note.toString();
        if (this._indexOfNote(noteStr) === -1) {
            this.heldNotes.push(noteStr);
            this.heldNotes.sort(function(a, b) {
                return Arpeggiator._noteToMidi(a) - Arpeggiator._noteToMidi(b);
            });
            this._rebuildAndRestart();
        }
    }

    stopNote(note) {
        if (!this.enabled) {
            this.voiceManager.stopNote(note);
            return;
        }

        var noteStr = note.toString();
        var idx = this._indexOfNote(noteStr);
        if (idx !== -1) {
            this.heldNotes.splice(idx, 1);
            if (this.heldNotes.length === 0) {
                this._stopArpeggio();
            } else {
                this._rebuildAndRestart();
            }
        }
    }

    // --- Parameter setters ---

    setEnabled(on) {
        this.enabled = on;
        if (!on) {
            this._stopArpeggio();
            this.heldNotes = [];
        }
    }

    setPattern(p) {
        this.pattern = p;
        if (this.heldNotes.length > 0 && this.enabled) {
            this._buildSequence();
            this._clampStep();
        }
    }

    setBpm(bpm) {
        this.bpm = Math.max(40, Math.min(240, bpm));
        if (this.intervalId !== null) {
            this._restartTimer();
        }
    }

    setDivision(d) {
        this.division = d;
        if (this.intervalId !== null) {
            this._restartTimer();
        }
    }

    setOctaveRange(r) {
        this.octaveRange = Math.max(1, Math.min(4, r));
        if (this.heldNotes.length > 0 && this.enabled) {
            this._buildSequence();
            this._clampStep();
        }
    }

    setGate(g) {
        this.gate = Math.max(25, Math.min(100, g));
    }

    // --- Internal methods ---

    _rebuildAndRestart() {
        this._buildSequence();
        if (this.sequence.length === 0) return;
        this._clampStep();
        if (this.intervalId === null) {
            this._startArpeggio();
        }
    }

    _buildSequence() {
        if (this.heldNotes.length === 0) {
            this.sequence = [];
            return;
        }

        // Expand held notes across octave range
        var expanded = [];
        for (var oct = 0; oct < this.octaveRange; oct++) {
            for (var i = 0; i < this.heldNotes.length; i++) {
                var midi = Arpeggiator._noteToMidi(this.heldNotes[i]) + (oct * 12);
                if (midi <= 127) {
                    expanded.push(Arpeggiator._midiToNote(midi));
                }
            }
        }

        switch (this.pattern) {
            case 'down':
                expanded.reverse();
                break;
            case 'up-down':
                if (expanded.length > 1) {
                    var descending = expanded.slice(1, -1).reverse();
                    expanded = expanded.concat(descending);
                }
                break;
            case 'down-up':
                expanded.reverse();
                if (expanded.length > 1) {
                    var ascending = expanded.slice(1, -1).reverse();
                    expanded = expanded.concat(ascending);
                }
                break;
            case 'random':
                // Random is handled at tick time, just keep the pool
                break;
            // 'up' is the default order
        }

        this.sequence = expanded;
    }

    _clampStep() {
        if (this.sequence.length === 0) {
            this.currentStep = 0;
        } else if (this.currentStep >= this.sequence.length) {
            this.currentStep = 0;
        }
    }

    _startArpeggio() {
        this._tick(); // Play first note immediately
        var self = this;
        this.intervalId = setInterval(function() { self._tick(); }, this._getStepMs());
    }

    _stopArpeggio() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.gateTimeoutId !== null) {
            clearTimeout(this.gateTimeoutId);
            this.gateTimeoutId = null;
        }
        if (this.currentArpNote !== null) {
            this.voiceManager.stopNote(this.currentArpNote);
            this.currentArpNote = null;
        }
        this.currentStep = 0;
    }

    _restartTimer() {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            var self = this;
            this.intervalId = setInterval(function() { self._tick(); }, this._getStepMs());
        }
    }

    _tick() {
        if (this.sequence.length === 0) return;

        // Stop previous note
        if (this.currentArpNote !== null) {
            this.voiceManager.stopNote(this.currentArpNote);
            this.currentArpNote = null;
        }
        if (this.gateTimeoutId !== null) {
            clearTimeout(this.gateTimeoutId);
            this.gateTimeoutId = null;
        }

        // Pick the next note
        var note;
        if (this.pattern === 'random') {
            note = this.sequence[Math.floor(Math.random() * this.sequence.length)];
        } else {
            note = this.sequence[this.currentStep];
            this.currentStep = (this.currentStep + 1) % this.sequence.length;
        }

        // Play note
        this.voiceManager.startNote(note);
        this.currentArpNote = note;

        // Schedule gate-off
        var gateMs = this._getStepMs() * (this.gate / 100);
        var self = this;
        this.gateTimeoutId = setTimeout(function() {
            if (self.currentArpNote === note) {
                self.voiceManager.stopNote(note);
                self.currentArpNote = null;
            }
            self.gateTimeoutId = null;
        }, gateMs);
    }

    _getStepMs() {
        var beatMs = 60000 / this.bpm;
        switch (this.division) {
            case '4':   return beatMs;
            case '8':   return beatMs / 2;
            case '8t':  return beatMs / 3;
            case '16':  return beatMs / 4;
            case '16t': return beatMs / 6;
            case '32':  return beatMs / 8;
            default:    return beatMs / 2;
        }
    }

    _indexOfNote(noteStr) {
        for (var i = 0; i < this.heldNotes.length; i++) {
            if (this.heldNotes[i] === noteStr) return i;
        }
        return -1;
    }

    // --- Static helpers for note/MIDI conversion ---

    static _noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    static _noteToMidi(note) {
        var str = note.toString();
        // Handle pure MIDI number
        if (/^\d+$/.test(str)) return parseInt(str);

        var match = str.match(/^([A-Ga-g]#?)(-?\d+)$/);
        if (!match) return 60;
        var name = match[1].toUpperCase();
        var octave = parseInt(match[2]);
        var idx = Arpeggiator._noteNames.indexOf(name);
        if (idx === -1) return 60;
        return (octave + 1) * 12 + idx;
    }

    static _midiToNote(midi) {
        var idx = midi % 12;
        var octave = Math.floor(midi / 12) - 1;
        return Arpeggiator._noteNames[idx] + octave;
    }
}
