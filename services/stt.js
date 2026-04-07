// ElevenLabs Speech-to-Text Service

class STTService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://api.elevenlabs.io/v1/speech-to-text';
  }

  async transcribe(audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.webm');
    formData.append('model_id', 'scribe_v1');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`STT failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    return data.text || '';
  }
}
