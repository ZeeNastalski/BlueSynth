class FilterBank {
    constructor(ctx, masterGainNode) {
        this.ctx = ctx;

        this.filters = {
            lowpass6: ctx.createBiquadFilter(),
            lowpass12: ctx.createBiquadFilter(),
            lowpass24: [
                ctx.createBiquadFilter(),
                ctx.createBiquadFilter()
            ]
        };

        // Initialize all filters as lowpass
        [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24].forEach(filter => {
            filter.type = 'lowpass';
            filter.frequency.value = 20000;
            filter.Q.value = 0;
        });

        // Butterworth response for 12dB
        this.filters.lowpass12.Q.value = 0.707;

        // 24dB cascaded pair Q values
        this.filters.lowpass24[0].Q.value = 0.54;
        this.filters.lowpass24[1].Q.value = 1.31;

        // Connect 4-pole filters in series
        this.filters.lowpass24[0].connect(this.filters.lowpass24[1]);
        this.filters.lowpass24[1].connect(masterGainNode);

        // Connect other filters to master gain
        this.filters.lowpass6.connect(masterGainNode);
        this.filters.lowpass12.connect(masterGainNode);

        // Default to 24dB
        this.currentFilter = this.filters.lowpass24[0];
        this.currentFilterType = 'lowpass24';
    }

    get inputNode() {
        return this.currentFilter;
    }

    get type() {
        return this.currentFilterType;
    }

    get allFilters() {
        return [this.filters.lowpass6, this.filters.lowpass12, ...this.filters.lowpass24];
    }

    setType(newType) {
        const oldType = this.currentFilterType;

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

        return { oldType, newType };
    }

    setFrequency(freq) {
        this.allFilters.forEach(filter => {
            filter.frequency.value = freq;
        });
    }

    setQ(q) {
        switch (this.currentFilterType) {
            case 'lowpass6':
                this.filters.lowpass6.Q.value = q;
                break;
            case 'lowpass12':
                this.filters.lowpass12.Q.value = q;
                break;
            case 'lowpass24':
                this.filters.lowpass24[0].Q.value = q * 0.54 / 1.0;
                this.filters.lowpass24[1].Q.value = q * 1.31 / 1.0;
                break;
        }
    }

    logFrequency(value) {
        const minFreqLog = Math.log2(20);
        const maxFreqLog = Math.log2(20000);
        const range = maxFreqLog - minFreqLog;
        const logValue = minFreqLog + (value / 100) * range;
        return Math.pow(2, logValue);
    }

    formatFrequency(freq) {
        if (freq >= 1000) {
            return `${(freq / 1000).toFixed(1)}kHz`;
        }
        return `${Math.round(freq)}Hz`;
    }
}
