// Screen capture via getDisplayMedia — uses macOS system screen sharing picker
// This bypasses the Screen Recording checkbox in System Settings

class ScreenCapture {
  constructor() {
    this.stream = null;
    this.video = null;
    this.canvas = null;
    this.ctx = null;
    this.ready = false;
  }

  async init() {
    try {
      // This triggers the macOS screen sharing system picker
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });

      // Create a hidden video element to receive the stream
      this.video = document.createElement('video');
      this.video.srcObject = this.stream;
      this.video.style.display = 'none';
      document.body.appendChild(this.video);
      await this.video.play();

      // Create canvas for frame capture
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');

      this.ready = true;
      console.log('OraAI: Screen capture stream ready');

      // Handle stream ending (user revokes sharing)
      this.stream.getVideoTracks()[0].onended = () => {
        console.log('OraAI: Screen sharing stopped');
        this.ready = false;
      };

      return true;
    } catch (err) {
      console.error('OraAI: Screen capture init failed:', err);
      return false;
    }
  }

  async capture() {
    if (!this.ready || !this.video) {
      // Try to reinitialize
      console.log('OraAI: Reinitializing screen capture...');
      const ok = await this.init();
      if (!ok) return null;
    }

    try {
      const w = this.video.videoWidth;
      const h = this.video.videoHeight;

      if (w === 0 || h === 0) {
        console.warn('OraAI: Video dimensions are 0');
        return null;
      }

      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(this.video, 0, 0, w, h);

      // Clean screenshot — no grid overlay (grids hide small UI elements)

      // Get as JPEG base64
      const dataUrl = this.canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1];

      const screenInfo = await window.oraAPI.getScreenInfo();

      console.log(`OraAI: Screenshot captured ${w}x${h}`);

      return {
        base64,
        width: w,
        height: h,
        scaleFactor: screenInfo.scaleFactor,
      };
    } catch (err) {
      console.error('OraAI: Frame capture error:', err);
      return null;
    }
  }

  destroy() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    if (this.video) {
      this.video.remove();
    }
    this.ready = false;
  }
}
