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

  async capture(cropRect) {
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

      const screenInfo = await window.oraAPI.getScreenInfo();
      const scaleFactor = screenInfo.scaleFactor || 1;
      const screenW = screenInfo.width;
      const screenH = screenInfo.height;

      // If working area crop is provided, crop to that region
      if (cropRect) {
        const cx = Math.round(cropRect.left * scaleFactor);
        const cy = Math.round(cropRect.top * scaleFactor);
        const cw = Math.round(cropRect.width * scaleFactor);
        const ch = Math.round(cropRect.height * scaleFactor);

        // Clamp to video bounds
        const sx = Math.max(0, Math.min(cx, w - 1));
        const sy = Math.max(0, Math.min(cy, h - 1));
        const sw = Math.min(cw, w - sx);
        const sh = Math.min(ch, h - sy);

        // Create a cropped canvas
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = sw;
        cropCanvas.height = sh;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(this.canvas, sx, sy, sw, sh, 0, 0, sw, sh);

        const dataUrl = cropCanvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1];

        console.log(`OraAI: Screenshot cropped ${w}x${h} → ${sw}x${sh} (screen region ${cropRect.width}x${cropRect.height} at ${cropRect.left},${cropRect.top})`);

        return {
          base64,
          width: sw,
          height: sh,
          // The screen-point region this screenshot covers (for coordinate mapping)
          displayRegionW: cropRect.width,
          displayRegionH: cropRect.height,
          displayOffsetX: cropRect.left,
          displayOffsetY: cropRect.top,
        };
      }

      // Full screen capture
      const dataUrl = this.canvas.toDataURL('image/jpeg', 0.8);
      const base64 = dataUrl.split(',')[1];

      console.log(`OraAI: Screenshot captured ${w}x${h}`);

      return {
        base64,
        width: w,
        height: h,
        // Full screen: region = entire display, offset = 0,0
        displayRegionW: screenW,
        displayRegionH: screenH,
        displayOffsetX: 0,
        displayOffsetY: 0,
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
