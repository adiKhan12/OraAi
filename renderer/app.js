// OraAI — Main Application Orchestrator

(async function () {
  // --- Init ---
  const config = await window.oraAPI.getConfig();
  const canvas = document.getElementById('orb-canvas');
  const transcriptBar = document.getElementById('transcript-bar');

  const stateMachine = new StateMachine();
  const orb = new OrbRenderer(canvas);
  const recorder = new AudioRecorder();
  const screenCapture = new ScreenCapture();
  const sttService = new STTService(config.elevenlabsKey);
  const visionService = new VisionService(config.openrouterKey, config.visionModel);
  const ttsService = new TTSService(config.elevenlabsKey);
  const guideCtrl = new GuideController(orb, ttsService);

  // --- Working area state ---
  let workingArea = config.workingArea || { enabled: false, width: 1280, height: 900, showBorder: true, resizing: false };
  orb.setWorkingArea(workingArea);

  // Resize mode
  const resizeOverlay = document.getElementById('resize-overlay');
  const resizeBox = document.getElementById('resize-box');
  let resizeDragging = false;
  let resizeDir = null;
  let resizeStart = { x: 0, y: 0, left: 0, top: 0, width: 0, height: 0 };

  function enterResizeMode() {
    resizeOverlay.style.display = 'block';
    positionResizeBox();
  }

  function exitResizeMode() {
    resizeOverlay.style.display = 'none';
    resizeDragging = false;
    resizeDir = null;
    workingArea.resizing = false;
    orb.setWorkingArea(workingArea);
    window.oraAPI.workingAreaResizeDone({ width: workingArea.width, height: workingArea.height });
    console.log(`OraAI: Resize done — ${workingArea.width}×${workingArea.height}`);
  }

  function positionResizeBox() {
    const rect = orb.getWorkingAreaRect();
    resizeBox.style.left = rect.left + 'px';
    resizeBox.style.top = rect.top + 'px';
    resizeBox.style.width = rect.width + 'px';
    resizeBox.style.height = rect.height + 'px';
  }

  // Handle drag start on any handle or edge
  resizeBox.addEventListener('mousedown', (e) => {
    const dir = e.target.dataset.dir;
    if (!dir) return;
    e.preventDefault();
    resizeDragging = true;
    resizeDir = dir;
    const rect = orb.getWorkingAreaRect();
    resizeStart = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });

  resizeOverlay.addEventListener('mousemove', (e) => {
    if (!resizeDragging || !resizeDir) return;
    const dx = e.clientX - resizeStart.x;
    const dy = e.clientY - resizeStart.y;
    let { left, top, width, height } = resizeStart;

    // Adjust based on drag direction
    if (resizeDir.includes('w')) { left += dx; width -= dx; }
    if (resizeDir.includes('e')) { width += dx; }
    if (resizeDir.includes('n')) { top += dy; height -= dy; }
    if (resizeDir.includes('s')) { height += dy; }

    // Enforce minimums
    if (width < 400) { if (resizeDir.includes('w')) left = resizeStart.left + resizeStart.width - 400; width = 400; }
    if (height < 300) { if (resizeDir.includes('n')) top = resizeStart.top + resizeStart.height - 300; height = 300; }

    workingArea.width = Math.round(width);
    workingArea.height = Math.round(height);
    orb.lockedRect = { left: Math.round(left), top: Math.round(top) };
    orb.setWorkingArea(workingArea);
    positionResizeBox();
  });

  resizeOverlay.addEventListener('mouseup', () => {
    resizeDragging = false;
    resizeDir = null;
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && workingArea.resizing) {
      exitResizeMode();
    }
  });

  // Initialize microphone
  try {
    await recorder.init();
    console.log('OraAI: Microphone ready');
  } catch (e) {
    console.error('OraAI: Microphone access denied', e);
  }

  // Initialize screen capture
  console.log('OraAI: Requesting screen sharing...');
  const screenOk = await screenCapture.init();
  if (screenOk) {
    console.log('OraAI: Screen sharing active');
  } else {
    console.error('OraAI: Screen sharing denied — will retry on first query');
  }

  // --- Transcript bar helpers ---
  let transcriptEnabled = true;

  window.oraAPI.onSettingChanged((settings) => {
    if (settings.showTranscript !== undefined) {
      transcriptEnabled = settings.showTranscript;
      if (!transcriptEnabled) hideTranscript();
      console.log('OraAI: Transcript bar', transcriptEnabled ? 'ON' : 'OFF');
    }
    if (settings.visionModel) {
      visionService.model = settings.visionModel;
      console.log(`OraAI: Vision model → ${settings.visionModel}`);
    }
    if (settings.workingArea) {
      const wa = settings.workingArea;
      workingArea = { ...workingArea, ...wa };
      orb.setWorkingArea(workingArea);
      if (wa.resizing) {
        enterResizeMode();
      }
      console.log(`OraAI: Working area ${workingArea.enabled ? 'ON' : 'OFF'} ${workingArea.width}×${workingArea.height}`);
    }
  });

  function showTranscript(text, type) {
    if (!transcriptEnabled) return;
    transcriptBar.innerHTML = type === 'listening'
      ? `<div class="label">Listening...</div>${text || ''}`
      : text;
    transcriptBar.className = type === 'listening' ? 'visible listening' : 'visible';
  }

  function hideTranscript() {
    transcriptBar.className = '';
    setTimeout(() => { transcriptBar.innerHTML = ''; }, 300);
  }

  // --- Wire up state changes ---
  stateMachine.onTransition((newState, oldState) => {
    console.log(`OraAI: ${oldState} → ${newState}`);
    orb.setState(newState);

    if (newState === OrbState.LISTENING) {
      showTranscript('', 'listening');
    } else if (newState === OrbState.IDLE) {
      hideTranscript();
    }
  });

  // --- Mouse tracking ---
  const screenInfo = await window.oraAPI.getScreenInfo();
  const windowY = screenInfo.windowY || 0;
  console.log(`OraAI: Window Y offset: ${windowY}px`);
  window.oraAPI.onMouseMove((point) => {
    orb.setMousePosition(point.x, point.y - windowY);
  });

  // --- Audio level → orb ---
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
      showTranscript('Processing...', 'thinking');
      const audioBlob = await recorder.stop();

      if (!audioBlob || audioBlob.size < 1000) {
        console.warn('OraAI: Audio too short, ignoring');
        stateMachine.transition(OrbState.IDLE);
        return;
      }

      // 2. Transcribe + screenshot + AX elements in parallel
      console.log('OraAI: Transcribing + capturing screen + reading UI...');
      const cropRect = workingArea.enabled ? orb.getWorkingAreaRect() : null;
      const [transcript, screenshot, axElements] = await Promise.all([
        sttService.transcribe(audioBlob),
        screenCapture.capture(cropRect),
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

      // Show transcript immediately so user knows they were heard
      showTranscript(`"${transcript}"`, 'heard');

      // 3. Send to Vision AI
      console.log('OraAI: Sending to AI...');
      const aiResponse = await visionService.analyze(
        screenshot?.base64 || '',
        transcript,
        screenshot?.width || window.innerWidth,
        screenshot?.height || window.innerHeight,
        axElements,
        screenshot  // pass full screenshot meta for coordinate mapping
      );

      console.log('OraAI: AI Response:', JSON.stringify(aiResponse).substring(0, 200));

      // 4. Respond based on type — AI coords are already in screen points
      if (aiResponse.type === 'speak') {
        console.log('OraAI: Speaking answer (no guide)');
        hideTranscript();
        try {
          await ttsService.speak(aiResponse.answer || aiResponse.summary || 'I don\'t have an answer for that.');
        } catch {}
      } else {
        hideTranscript();
        stateMachine.transition(OrbState.GUIDING);
        await guideCtrl.runGuide(aiResponse);
      }

      // 5. Done
      stateMachine.transition(OrbState.IDLE);

    } catch (error) {
      console.error('OraAI: Pipeline error:', error);
      hideTranscript();
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
