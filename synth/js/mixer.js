class Mixer {
    constructor(ctx) {
        this.ctx = ctx;

        this.masterGain = ctx.createGain();
        this.masterGain.gain.value = 1;

        this.masterLevel = ctx.createGain();
        this.masterLevel.gain.value = 1.0;

        this.mixerAnalyzer = ctx.createAnalyser();
        this.mixerAnalyzer.fftSize = 1024;
        this.mixerAnalyzer.smoothingTimeConstant = 0.2;

        // Internal wiring: masterGain → mixerAnalyzer, masterGain → masterLevel
        this.masterGain.connect(this.mixerAnalyzer);
        this.masterGain.connect(this.masterLevel);

        // Normalization settings
        this.normalizationType = 'logarithmic';
        this.voiceScaling = 75; // 0-100 integer for slider

        // Oscillator levels
        this.osc1Level = 0.25;
        this.osc2Level = 0.25;
        this.osc3Level = 0.25;
        this.osc4Level = 0.25;
    }

    updateMasterGain(activeNoteCount) {
        const totalLinearGain = this.osc1Level + this.osc2Level + this.osc3Level + this.osc4Level;
        const noteCount = Math.max(1, activeNoteCount);

        if (this.normalizationType === 'logarithmic') {
            const scaleFactor = Math.max(1, Math.pow(noteCount, this.voiceScaling / 100));
            const logGain = Math.log10(1 + totalLinearGain * scaleFactor) / Math.log10(2);
            // -12dB safety headroom
            this.masterGain.gain.value = 0.25 / Math.max(1, logGain);
        } else {
            // Linear gain reduction
            this.masterGain.gain.value = 0.5 / Math.max(1, Math.pow(noteCount, this.voiceScaling / 100));
        }

        // Scale master level to prevent clipping
        const masterLevelSlider = document.getElementById('master-level');
        const masterLevelValue = masterLevelSlider ? parseInt(masterLevelSlider.value) / 100 : 1.0;
        const masterLevelScaling = 0.7; // -3dB safety margin
        this.masterLevel.gain.value = masterLevelValue * masterLevelScaling;
    }

    startMixerMetering(meterElementId) {
        const updateMixerMeter = () => {
            const meter = document.getElementById(meterElementId);
            if (!meter) return;

            const dataArray = new Float32Array(this.mixerAnalyzer.frequencyBinCount);
            this.mixerAnalyzer.getFloatTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const db = 20 * Math.log10(rms || 0.00001);
            const height = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));

            meter.style.height = `${height}%`;

            if (db > -3) {
                meter.classList.add('clipping');
            } else {
                meter.classList.remove('clipping');
            }

            requestAnimationFrame(updateMixerMeter);
        };

        updateMixerMeter();
    }

    startOutputMetering(outputAnalyzer, meterElementId) {
        const updateMeter = () => {
            const meter = document.getElementById(meterElementId);
            if (!meter) return;

            const dataArray = new Float32Array(outputAnalyzer.frequencyBinCount);
            outputAnalyzer.getFloatTimeDomainData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            const rms = Math.sqrt(sum / dataArray.length);
            const db = 20 * Math.log10(rms || 0.00001);
            const height = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));

            meter.style.height = `${height}%`;

            if (db > -3) {
                meter.classList.add('clipping');
            } else {
                meter.classList.remove('clipping');
            }

            requestAnimationFrame(updateMeter);
        };

        updateMeter();
    }
}
