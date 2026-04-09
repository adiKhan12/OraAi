// ElevenLabs Text-to-Speech Service

class TTSService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    // "Rachel" voice — clear, friendly. Change voice_id for different voice.
    this.voiceId = '21m00Tcm4TlvDq8ikWAM';
    this.endpoint = `https://api.elevenlabs.io/v1/text-to-speech`;
    this.audioContext = null;
    this.currentSource = null;
  }

  cleanForSpeech(text) {
    return text
      .replace(/\[POINT:\d+,\d+(?::[^\]]*)?]/g, '')  // remove [POINT:x,y:label]
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')        // **bold**, *italic*, ***both***
      .replace(/`{1,3}[^`]*`{1,3}/g, '')              // `code` and ```blocks```
      .replace(/^#{1,6}\s+/gm, '')                     // # headings
      .replace(/^\s*[-*+]\s+/gm, '')                   // - bullet points
      .replace(/^\s*\d+\.\s+/gm, '')                   // 1. numbered lists
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')          // [link](url) → link
      .replace(/\n{2,}/g, '. ')                        // paragraph breaks → pause
      .replace(/\s{2,}/g, ' ')                         // collapse whitespace
      .trim();
  }

  async speak(text) {
    text = this.cleanForSpeech(text);
    if (!text) return;
    const url = `${this.endpoint}/${this.voiceId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.3,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TTS failed (${response.status}): ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return this.playAudio(arrayBuffer);
  }

  async playAudio(arrayBuffer) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }

    // Stop any currently playing audio
    this.stopCurrent();

    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    this.currentSource = source;

    return new Promise((resolve) => {
      source.onended = () => {
        this.currentSource = null;
        resolve();
      };
      source.start(0);
    });
  }

  stopCurrent() {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* already stopped */ }
      this.currentSource = null;
    }
  }

  destroy() {
    this.stopCurrent();
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}
