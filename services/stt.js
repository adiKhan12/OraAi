// ElevenLabs Speech-to-Text Service

const STT_TIMEOUT_MS = 15000; // 15s timeout for transcription

class STTService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://api.elevenlabs.io/v1/speech-to-text';
  }

  async transcribe(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model_id', 'scribe_v1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STT_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
        },
        body: formData,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Transcription timed out — try again');
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`STT failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.text || '';
  }
}
