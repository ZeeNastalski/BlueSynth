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

    // 8. Arpeggiator (proxy between input and voice manager)
    const arpeggiator = new Arpeggiator(voiceManager);

    // 9. Wire LFO's deferred dependencies
    lfo.setVoiceAccessor(() => voiceManager.activeNotes);
    lfo.setFilterAccessor(() => filterBank.inputNode);

    // 10. Start level metering
    mixer.startMixerMetering('mixer-level-meter');
    mixer.startOutputMetering(audioEngine.outputAnalyzer, 'output-level-meter');

    // 11. UI bindings
    const ui = new UIController(audioEngine, filterBank, lfo, envelopes, effects, mixer, voiceManager, arpeggiator);
    ui.init();

    // 12. Input controller (receives arpeggiator as the note target)
    const inputController = new InputController(arpeggiator);
    inputController.initializeInputs();

    // 13. Initialize master gain
    mixer.updateMasterGain(0);

    console.log("Synthesizer initialized.");
});
