// Audio recording with silence detection

class AudioRecorder {
  constructor() {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.chunks = [];
    this.isRecording = false;
    this.silenceTimeout = null;
    this.silenceThreshold = 0.015; // Audio level below this = silence
    this.silenceDuration = 1500;   // ms of silence before auto-stop
    this.onSilenceStop = null;     // Callback when silence auto-stops
    this.onAudioLevel = null;      // Callback with current audio level (0-1)
    this._monitorInterval = null;
  }

  async init() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    });

    // Set up analyser for audio level monitoring
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
  }

  start() {
    if (this.isRecording) return;
    this.chunks = [];
    this.isRecording = true;

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: 'audio/webm;codecs=opus',
    });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.start(100); // Collect data every 100ms
    this.startMonitoring();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.isRecording) {
        resolve(null);
        return;
      }

      this.isRecording = false;
      this.stopMonitoring();

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm;codecs=opus' });
        this.chunks = [];
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  startMonitoring() {
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    let silenceStart = null;

    this._monitorInterval = setInterval(() => {
      if (!this.isRecording) return;

      this.analyser.getByteFrequencyData(dataArray);

      // Calculate average audio level (0-1)
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const level = sum / (dataArray.length * 255);

      // Report audio level
      if (this.onAudioLevel) this.onAudioLevel(level);

      // Silence detection
      if (level < this.silenceThreshold) {
        if (!silenceStart) silenceStart = Date.now();
        if (Date.now() - silenceStart > this.silenceDuration) {
          // Silence detected — auto-stop
          if (this.onSilenceStop) this.onSilenceStop();
        }
      } else {
        silenceStart = null;
      }
    }, 50);
  }

  stopMonitoring() {
    if (this._monitorInterval) {
      clearInterval(this._monitorInterval);
      this._monitorInterval = null;
    }
    if (this.silenceTimeout) {
      clearTimeout(this.silenceTimeout);
      this.silenceTimeout = null;
    }
  }

  destroy() {
    this.stopMonitoring();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
