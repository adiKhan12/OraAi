// OraAI — Main Application Orchestrator

(async function () {
  // --- Init ---
  const config = await window.oraAPI.getConfig();
  const canvas = document.getElementById('orb-canvas');

  const stateMachine = new StateMachine();
  const orb = new OrbRenderer(canvas);
  const recorder = new AudioRecorder();
  const screenCapture = new ScreenCapture();
  const sttService = new STTService(config.elevenlabsKey);
  const visionService = new VisionService(config.openrouterKey);
  const ttsService = new TTSService(config.elevenlabsKey);
  const guideCtrl = new GuideController(orb, ttsService);

  // Initialize microphone
  try {
    await recorder.init();
    console.log('OraAI: Microphone ready');
  } catch (e) {
    console.error('OraAI: Microphone access denied', e);
  }

  // Initialize screen capture (triggers macOS system picker)
  console.log('OraAI: Requesting screen sharing...');
  const screenOk = await screenCapture.init();
  if (screenOk) {
    console.log('OraAI: Screen sharing active');
  } else {
    console.error('OraAI: Screen sharing denied — will retry on first query');
  }

  // --- Wire up state changes to orb ---
  stateMachine.onTransition((newState, oldState) => {
    console.log(`OraAI: ${oldState} → ${newState}`);
    orb.setState(newState);
  });

  // --- Mouse tracking ---
  // Window starts at (0, windowY) on screen. Subtract windowY to get canvas coords.
  const screenInfo = await window.oraAPI.getScreenInfo();
  const windowY = screenInfo.windowY || 0;
  console.log(`OraAI: Window Y offset: ${windowY}px (menu bar height)`);
  window.oraAPI.onMouseMove((point) => {
    orb.setMousePosition(point.x, point.y - windowY);
  });

  // --- Audio level → orb visualization ---
  recorder.onAudioLevel = (level) => {
    orb.setAudioLevel(level);
  };

  // --- Silence auto-stop ---
  let silenceTriggered = false;
  recorder.onSilenceStop = () => {
    if (stateMachine.state === OrbState.LISTENING && !silenceTriggered) {
      silenceTriggered = true;
      processQuery();
    }
  };

  // --- Hotkey handler ---
  window.oraAPI.onHotkey((action) => {
    if (action === 'start') {
      if (stateMachine.state === OrbState.GUIDING) {
        guideCtrl.abort();
        stateMachine.transition(OrbState.IDLE);
        return;
      }

      stateMachine.transition(OrbState.LISTENING);
      silenceTriggered = false;
      recorder.start();
    }

    if (action === 'stop') {
      if (stateMachine.state === OrbState.LISTENING) {
        processQuery();
      }
    }
  });

  // --- Core pipeline ---
  async function processQuery() {
    try {
      // 1. Stop recording
      stateMachine.transition(OrbState.THINKING);
      const audioBlob = await recorder.stop();

      if (!audioBlob || audioBlob.size < 1000) {
        console.warn('OraAI: Audio too short, ignoring');
        stateMachine.transition(OrbState.IDLE);
        return;
      }

      // 2. Transcribe + screenshot + accessibility elements — all in parallel
      console.log('OraAI: Transcribing + capturing screen + reading UI elements...');
      const [transcript, screenshot, axElements] = await Promise.all([
        sttService.transcribe(audioBlob),
        screenCapture.capture(),
        window.oraAPI.getAXElements(),
      ]);

      console.log('OraAI: Transcript:', transcript);
      console.log('OraAI: Screenshot:', screenshot ? `${Math.round(screenshot.base64.length / 1024)}KB` : 'FAILED');
      console.log('OraAI: UI Elements:', axElements.length);

      if (!transcript || transcript.trim().length === 0) {
        console.warn('OraAI: Empty transcript');
        stateMachine.transition(OrbState.IDLE);
        return;
      }

      // 3. Send to Vision AI
      console.log('OraAI: Sending to AI...');
      const aiResponse = await visionService.analyze(
        screenshot?.base64 || '',
        transcript,
        screenshot?.width || window.innerWidth,
        screenshot?.height || window.innerHeight,
        axElements
      );

      console.log('OraAI: AI Response:', JSON.stringify(aiResponse).substring(0, 200));

      // 4. Respond based on type
      if (aiResponse.type === 'speak') {
        // General question — just speak the answer, orb stays with cursor
        console.log('OraAI: Speaking answer (no guide)');
        try {
          await ttsService.speak(aiResponse.answer || aiResponse.summary || 'I don\'t have an answer for that.');
        } catch {}
      } else {
        // Screen guidance — move orb to targets
        stateMachine.transition(OrbState.GUIDING);
        await guideCtrl.runGuide(aiResponse, {
          width: screenshot?.width || window.innerWidth,
          height: screenshot?.height || window.innerHeight,
        });
      }

      // 5. Done
      stateMachine.transition(OrbState.IDLE);

    } catch (error) {
      console.error('OraAI: Pipeline error:', error);
      try {
        await ttsService.speak('Sorry, something went wrong. Please try again.');
      } catch {}
      stateMachine.transition(OrbState.IDLE);
    }
  }

  // --- Start ---
  orb.start();
  console.log('OraAI: Ready — press Option+Space to talk');
})();
