class EffectsChain {
    constructor(ctx, inputNode, outputNode) {
        this.ctx = ctx;

        // Delay effect
        this.delay = {
            delayNode: ctx.createDelay(1.0),
            feedback: ctx.createGain(),
            mix: ctx.createGain()
        };
        this.delay.delayNode.delayTime.value = 0.2;
        this.delay.feedback.gain.value = 0.3;
        this.delay.mix.gain.value = 0.3;

        // Reverb effect
        this.reverb = {
            convolver: ctx.createConvolver(),
            mix: ctx.createGain()
        };
        this.reverb.mix.gain.value = 0.2;

        // Dry signal
        this.dryGain = ctx.createGain();
        this.dryGain.gain.value = 1;

        // Wire: inputNode → dry → outputNode
        inputNode.connect(this.dryGain);
        this.dryGain.connect(outputNode);

        // Wire: inputNode → delay → outputNode
        inputNode.connect(this.delay.delayNode);
        this.delay.delayNode.connect(this.delay.feedback);
        this.delay.feedback.connect(this.delay.delayNode);
        this.delay.delayNode.connect(this.delay.mix);
        this.delay.mix.connect(outputNode);

        // Wire: inputNode → reverb → outputNode
        inputNode.connect(this.reverb.convolver);
        this.reverb.convolver.connect(this.reverb.mix);
        this.reverb.mix.connect(outputNode);

        // Generate initial impulse response
        this.generateReverbIR();
    }

    setDelayTime(seconds) {
        this.delay.delayNode.delayTime.value = seconds;
    }

    setDelayFeedback(value) {
        this.delay.feedback.gain.value = value;
    }

    setDelayMix(value) {
        this.delay.mix.gain.value = value;
    }

    setReverbMix(value) {
        this.reverb.mix.gain.value = value;
    }

    generateReverbIR() {
        const sampleRate = this.ctx.sampleRate;
        const sizeSlider = document.getElementById('reverb-size');
        const dampingSlider = document.getElementById('reverb-damping');

        const size = sizeSlider ? parseInt(sizeSlider.value) / 100 : 0.5;
        const damping = dampingSlider ? parseInt(dampingSlider.value) / 100 : 0.5;

        const lengthSeconds = 0.5 + size * 3.5;
        const length = Math.floor(sampleRate * lengthSeconds);
        if (length <= 0) return;

        const impulseResponse = this.ctx.createBuffer(2, length, sampleRate);
        const leftChannel = impulseResponse.getChannelData(0);
        const rightChannel = impulseResponse.getChannelData(1);

        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const decayFactor = Math.pow(1 - damping, t * 10);
            const sizeDecay = Math.exp(-t / (lengthSeconds * 0.3));
            const envelope = sizeDecay * decayFactor;

            leftChannel[i] = (Math.random() * 2 - 1) * envelope;
            rightChannel[i] = (Math.random() * 2 - 1) * envelope;
        }

        // Normalize
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
