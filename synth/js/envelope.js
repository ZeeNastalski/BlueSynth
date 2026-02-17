class EnvelopeEngine {
    constructor(ctx) {
        this.ctx = ctx;

        // Amplitude envelope parameters (in milliseconds)
        this.ampEnvelope = {
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
            amount: 0.5,
            baseFreq: 20000
        };
    }

    applyAmplitudeEnvelope(gainNode, baseLevel, isNoteOn) {
        const now = this.ctx.currentTime;
        const gain = gainNode.gain;
        gain.cancelScheduledValues(now);

        if (isNoteOn) {
            gain.setValueAtTime(gain.value, now);
            gain.linearRampToValueAtTime(baseLevel, now + this.ampEnvelope.attack / 1000);
            gain.linearRampToValueAtTime(
                baseLevel * this.ampEnvelope.sustain,
                now + (this.ampEnvelope.attack + this.ampEnvelope.decay) / 1000
            );
        } else {
            const currentValue = gain.value;
            gain.setValueAtTime(currentValue, now);
            gain.exponentialRampToValueAtTime(0.00001, now + this.ampEnvelope.release / 1000);
            gain.setValueAtTime(0, now + this.ampEnvelope.release / 1000 + 0.001);
        }
    }

    applyFilterEnvelope(isNoteOn, allFilters) {
        const now = this.ctx.currentTime;
        const baseFreq = this.filterEnvelope.baseFreq;
        const amount = this.filterEnvelope.amount;
        const attackTime = this.filterEnvelope.attack / 1000;
        const decayTime = this.filterEnvelope.decay / 1000;
        const sustainLevel = this.filterEnvelope.sustain;
        const releaseTime = this.filterEnvelope.release / 1000;

        const maxFreq = baseFreq * Math.pow(2, amount * 4);
        const sustainFreq = baseFreq * Math.pow(2, amount * sustainLevel * 4);

        allFilters.forEach(filter => {
            if (!filter || !filter.frequency) return;

            const freqParam = filter.frequency;
            freqParam.cancelScheduledValues(now);

            if (isNoteOn) {
                freqParam.setValueAtTime(freqParam.value, now);
                freqParam.linearRampToValueAtTime(maxFreq, now + attackTime);
                freqParam.linearRampToValueAtTime(sustainFreq, now + attackTime + decayTime);
            } else {
                const currentFreq = freqParam.value;
                freqParam.setValueAtTime(currentFreq, now);
                freqParam.linearRampToValueAtTime(baseFreq, now + releaseTime);
            }
        });
    }
}
