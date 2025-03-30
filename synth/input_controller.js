class InputController {
    constructor(synthesizer) {
        this.synthesizer = synthesizer; // Reference to the main synth engine
        this.midiAccess = null;
        this.baseOctave = 0; // Can be -2 to +2
        this.pressedKeys = new Set(); // Track pressed physical keys to prevent repeats
        console.log("InputController: Instance created."); // Log constructor
    }

    initializeInputs() {
        console.log("InputController: Initializing inputs..."); // Log start
        try {
            this.initMIDI();
            this.setupKeyboardListeners();
            this.updateOctaveDisplay(); // Initial display update
            this.updateMIDIStatus(); // Initial MIDI status update
            console.log("InputController: Inputs initialized successfully."); // Log success
        } catch (error) {
            console.error("InputController: Error during input initialization:", error); // Log errors
        }
    }

    // --- MIDI Methods ---

    async initMIDI() {
        console.log("InputController: initMIDI called."); // Log MIDI init start
        if (!navigator.requestMIDIAccess) {
            console.error('InputController: WebMIDI API not available.'); // Log if API missing
            this.updateMIDIStatus();
            return;
        }

        try {
            console.log("InputController: Requesting MIDI access..."); // Log before request
            this.midiAccess = await navigator.requestMIDIAccess();
            console.log("InputController: MIDI access granted.", this.midiAccess); // Log success

            // Listen for MIDI device connections/disconnections
            this.midiAccess.onstatechange = (e) => {
                console.log(`InputController: MIDI state change - ${e.port.name} ${e.port.state}`);
                this.updateMIDIStatus();
                // Re-attach listeners if a device connects
                if (e.port.state === 'connected' && e.port.type === 'input') {
                    e.port.onmidimessage = this.handleMIDIMessage.bind(this);
                    console.log(`InputController: MIDI listener re-attached to ${e.port.name}`);
                }
            };

            // Set up MIDI input handling for currently connected devices
            if (this.midiAccess.inputs.size > 0) {
                 console.log(`InputController: Setting up listeners for ${this.midiAccess.inputs.size} MIDI inputs.`);
                 this.midiAccess.inputs.forEach(input => {
                    input.onmidimessage = this.handleMIDIMessage.bind(this);
                    console.log(`InputController: MIDI listener attached to ${input.name}`);
                });
            } else {
                 console.log("InputController: No MIDI input devices initially connected.");
            }


            // Update initial MIDI status
            this.updateMIDIStatus();
        } catch (error) {
            console.error('InputController: Error accessing MIDI devices:', error); // Log MIDI errors
            this.midiAccess = null; // Ensure midiAccess is null on error
            this.updateMIDIStatus();
        }
    }

    handleMIDIMessage(message) {
        const [status, note, velocity] = message.data;
        const command = status >> 4;
        console.log(`InputController: MIDI Message - Cmd: ${command}, Note: ${note}, Vel: ${velocity}`); // Log MIDI message

        // Note on
        if (command === 9 && velocity > 0) {
            this.synthesizer.startNote(note);
            const noteName = this.midiNoteToNoteName(note);
            const key = document.querySelector(`.key[data-note="${noteName}"]`);
            if (key) key.classList.add('active');
        }
        // Note off or note on with velocity 0
        else if (command === 8 || (command === 9 && velocity === 0)) {
            this.synthesizer.stopNote(note);
            const noteName = this.midiNoteToNoteName(note);
            const key = document.querySelector(`.key[data-note="${noteName}"]`);
            if (key) key.classList.remove('active');
        }
    }

    updateMIDIStatus() {
        const statusElement = document.getElementById('midi-status');
        if (!statusElement) {
             console.warn("InputController: MIDI status element not found.");
             return;
        }

        if (!this.midiAccess) {
            statusElement.textContent = 'MIDI: Not Supported';
            statusElement.classList.remove('connected', 'disconnected');
            statusElement.classList.add('notsupported');
            return;
        }

        let hasActiveInput = false;
        if (this.midiAccess.inputs.size > 0) {
             this.midiAccess.inputs.forEach(input => {
                 if (!input.state || input.state === 'connected') {
                     hasActiveInput = true;
                 }
             });
        }

        if (hasActiveInput) {
            statusElement.textContent = 'MIDI: Connected';
            statusElement.classList.remove('notsupported', 'disconnected');
            statusElement.classList.add('connected');
        } else {
            statusElement.textContent = 'MIDI: Disconnected';
             statusElement.classList.remove('notsupported', 'connected');
            statusElement.classList.add('disconnected');
        }
         console.log(`InputController: Updated MIDI Status - ${statusElement.textContent}`);
    }

    midiNoteToNoteName(midiNote) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12) - 1;
        const noteIndex = midiNote % 12;
        return notes[noteIndex] + octave;
    }

    // --- Keyboard Methods ---

    setupKeyboardListeners() {
        console.log("InputController: setupKeyboardListeners called."); // Log keyboard setup start
        const keys = document.querySelectorAll('.key');
        console.log(`InputController: Found ${keys.length} key elements for virtual keyboard.`); // Log key count
        if (keys.length === 0) {
            console.warn("InputController: No elements with class 'key' found for virtual keyboard listeners.");
        }

        keys.forEach(key => {
            const note = key.dataset.note;
            // console.log(`InputController: Setting up listeners for key ${note}`); // Log each key setup (can be verbose)

            const handleMouseDown = (e) => {
                e.preventDefault();
                console.log(`InputController: MouseDown/TouchStart on key ${note}`); // Log event trigger
                if (note && !key.classList.contains('active')) {
                    try {
                        this.synthesizer.startNote(note);
                        key.classList.add('active');
                         console.log(`InputController: Started note ${note} (virtual)`);
                    } catch (err) {
                         console.error(`InputController: Error starting note ${note} (virtual):`, err);
                    }
                }
            };

            const handleMouseUpOrLeave = () => {
                if (key.classList.contains('active')) {
                    console.log(`InputController: MouseUp/TouchEnd/MouseLeave detected for key ${note}`); // Log event trigger
                    if (note) {
                         try {
                            this.synthesizer.stopNote(note);
                            key.classList.remove('active');
                             console.log(`InputController: Stopped note ${note} (virtual)`);
                         } catch (err) {
                             console.error(`InputController: Error stopping note ${note} (virtual):`, err);
                         }
                    }
                }
            };

            key.addEventListener('mousedown', handleMouseDown);
            key.addEventListener('touchstart', handleMouseDown, { passive: false });

            document.addEventListener('mouseup', handleMouseUpOrLeave);
            document.addEventListener('touchend', handleMouseUpOrLeave);
            key.addEventListener('mouseleave', handleMouseUpOrLeave);
        });

        console.log("InputController: Setting up physical keyboard listeners."); // Log physical key setup
        document.addEventListener('keydown', (e) => {
            if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

            const keyMap = this.getKeyMap();
            const note = keyMap[e.key.toLowerCase()];

            if (note && !this.pressedKeys.has(e.code)) {
                e.preventDefault();
                console.log(`InputController: KeyDown '${e.key}' mapped to note ${note}`); // Log physical key press
                this.pressedKeys.add(e.code);
                const keyElement = document.querySelector(`.key[data-note="${note}"]`);
                if (keyElement) {
                     try {
                        this.synthesizer.startNote(note);
                        keyElement.classList.add('active');
                         console.log(`InputController: Started note ${note} (physical)`);
                     } catch (err) {
                         console.error(`InputController: Error starting note ${note} (physical):`, err);
                     }
                }
            } else if (e.key.toLowerCase() === 'z') {
                 e.preventDefault();
                 console.log("InputController: KeyDown 'z' - Octave Down");
                this.shiftOctave(-1);
            } else if (e.key.toLowerCase() === 'x') {
                 e.preventDefault();
                 console.log("InputController: KeyDown 'x' - Octave Up");
                this.shiftOctave(1);
            }
        });

        document.addEventListener('keyup', (e) => {
             if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

            const keyMap = this.getKeyMap();
            const note = keyMap[e.key.toLowerCase()];

            if (note && this.pressedKeys.has(e.code)) {
                 e.preventDefault();
                 console.log(`InputController: KeyUp '${e.key}' mapped to note ${note}`); // Log physical key release
                this.pressedKeys.delete(e.code);
                const keyElement = document.querySelector(`.key[data-note="${note}"]`);
                if (keyElement) {
                     try {
                        this.synthesizer.stopNote(note);
                        keyElement.classList.remove('active');
                         console.log(`InputController: Stopped note ${note} (physical)`);
                     } catch (err) {
                         console.error(`InputController: Error stopping note ${note} (physical):`, err);
                     }
                }
            }
        });

        // Octave shift button listeners
         const octaveDownButton = document.getElementById('octave-down');
         const octaveUpButton = document.getElementById('octave-up');

         if (octaveDownButton) {
             console.log("InputController: Adding listener for octave-down button.");
            octaveDownButton.addEventListener('click', () => {
                 console.log("InputController: Octave Down button clicked.");
                 this.shiftOctave(-1);
            });
         } else {
             console.warn("InputController: Octave Down button not found.");
         }
         if (octaveUpButton) {
             console.log("InputController: Adding listener for octave-up button.");
            octaveUpButton.addEventListener('click', () => {
                 console.log("InputController: Octave Up button clicked.");
                 this.shiftOctave(1);
            });
         } else {
             console.warn("InputController: Octave Up button not found.");
         }
         console.log("InputController: Keyboard listeners setup complete."); // Log keyboard setup end
    }

    getKeyMap() {
        const startOctave = 4 + this.baseOctave;
        return {
            'a': `C${startOctave}`, 'w': `C#${startOctave}`, 's': `D${startOctave}`, 'e': `D#${startOctave}`,
            'd': `E${startOctave}`, 'f': `F${startOctave}`, 't': `F#${startOctave}`, 'g': `G${startOctave}`,
            'y': `G#${startOctave}`, 'h': `A${startOctave}`, 'u': `A#${startOctave}`, 'j': `B${startOctave}`,
            'k': `C${startOctave + 1}`, 'o': `C#${startOctave + 1}`, 'l': `D${startOctave + 1}`,
            'p': `D#${startOctave + 1}`, ';': `E${startOctave + 1}`, "'": `F${startOctave + 1}`
        };
    }

    shiftOctave(delta) {
        const newOctave = this.baseOctave + delta;
        if (newOctave >= -2 && newOctave <= 2) {
            console.log(`InputController: Shifting octave from ${this.baseOctave} to ${newOctave}`);
            const oldBaseOctave = this.baseOctave;
            this.baseOctave = newOctave;
            this.updateOctaveDisplay();

            document.querySelectorAll('.key[data-note]').forEach(key => {
                const currentNote = key.dataset.note;
                const match = currentNote.match(/([A-G]#?)(\d+)/);
                if (match) {
                    const noteName = match[1];
                    const octave = parseInt(match[2]);
                    if (!isNaN(octave)) {
                        const originalOctave = octave - oldBaseOctave;
                        const newNote = noteName + (originalOctave + this.baseOctave);
                        // console.log(`InputController: Updating key ${currentNote} to ${newNote}`); // Verbose log
                        key.dataset.note = newNote;
                    } else {
                         console.warn(`Could not parse octave from note: ${currentNote}`);
                    }
                } else {
                     console.warn(`Could not parse note name/octave from: ${currentNote}`);
                }
            });
        } else {
             console.log(`InputController: Octave shift blocked (current: ${this.baseOctave}, delta: ${delta})`);
        }
    }

    updateOctaveDisplay() {
        const display = document.getElementById('octave-display');
         if (!display) {
             console.warn("InputController: Octave display element not found.");
             return;
         }
        const startOctaveNum = 4 + this.baseOctave;
        const keyMap = this.getKeyMap();
        const notes = Object.values(keyMap);
        if (notes.length > 0) {
            const lowestNote = notes[0];
            const highestNote = notes[notes.length - 1];
             display.textContent = `${lowestNote} - ${highestNote}`;
        } else {
             display.textContent = `C${startOctaveNum} - F${startOctaveNum+1}`;
        }
         console.log(`InputController: Updated octave display to ${display.textContent}`);

        const octaveDownButton = document.getElementById('octave-down');
        const octaveUpButton = document.getElementById('octave-up');
        if (octaveDownButton) octaveDownButton.disabled = this.baseOctave <= -2;
        if (octaveUpButton) octaveUpButton.disabled = this.baseOctave >= 2;
    }
}