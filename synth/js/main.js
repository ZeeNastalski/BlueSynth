window.addEventListener('load', () => {
    // 1. Audio foundation
    const audioEngine = new AudioEngine();
    const ctx = audioEngine.ctx;

    // 2. Mixer (masterGain, masterLevel, metering)
    const mixer = new Mixer(ctx);

    // 3. Filter bank (connects outputs to mixer.masterGain)
    const filterBank = new FilterBank(ctx, mixer.masterGain);

    // 4. Effects chain (reads from mixer.masterLevel, writes to audioEngine.finalSumming)
    const effects = new EffectsChain(ctx, mixer.masterLevel, audioEngine.finalSumming);

    // 5. Envelopes (amplitude + filter ADSR)
    const envelopes = new EnvelopeEngine(ctx);

    // 6. LFO
    const lfo = new LFO(ctx);

    // 7. Voice manager (the coordinator)
    const voiceManager = new VoiceManager(ctx, envelopes, filterBank, lfo, mixer);

    // 8. Wire LFO's deferred dependencies
    lfo.setVoiceAccessor(() => voiceManager.activeNotes);
    lfo.setFilterAccessor(() => filterBank.inputNode);

    // 9. Start level metering
    mixer.startMixerMetering('mixer-level-meter');
    mixer.startOutputMetering(audioEngine.outputAnalyzer, 'output-level-meter');

    // 10. UI bindings
    const ui = new UIController(audioEngine, filterBank, lfo, envelopes, effects, mixer, voiceManager);
    ui.init();

    // 11. Input controller
    const inputController = new InputController(voiceManager);
    inputController.initializeInputs();

    // 12. Initialize master gain
    mixer.updateMasterGain(0);

    console.log("Synthesizer initialized.");
});
