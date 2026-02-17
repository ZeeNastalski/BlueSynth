class AudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();

        this.outputAnalyzer = this.ctx.createAnalyser();
        this.outputAnalyzer.fftSize = 1024;
        this.outputAnalyzer.smoothingTimeConstant = 0.2;

        this.finalSumming = this.ctx.createGain();
        this.finalSumming.gain.value = 1.0;

        this.finalSumming.connect(this.outputAnalyzer);
        this.finalSumming.connect(this.ctx.destination);
    }

    resume() {
        if (this.ctx.state === 'suspended') {
            return this.ctx.resume();
        }
        return Promise.resolve();
    }
}
