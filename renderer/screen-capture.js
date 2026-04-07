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

  drawGrid(w, h) {
    const ctx = this.ctx;
    const step = 100; // Grid every 100px for precision

    ctx.save();

    // Thin lines every 100px
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.25)';
    ctx.lineWidth = 1;
    for (let x = step; x < w; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = step; y < h; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Bold lines every 200px
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.lineWidth = 2;
    for (let x = 200; x < w; x += 200) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 200; y < h; y += 200) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Labels at every 200px intersection with background boxes
    ctx.font = 'bold 16px monospace';
    for (let x = 200; x < w; x += 200) {
      for (let y = 200; y < h; y += 200) {
        const label = `${x},${y}`;
        const tw = ctx.measureText(label).width;
        // Background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x + 2, y - 18, tw + 6, 20);
        // Text
        ctx.fillStyle = 'rgba(255, 50, 50, 1.0)';
        ctx.fillText(label, x + 5, y - 2);
      }
    }

    // Edge labels for X axis (top)
    for (let x = 200; x < w; x += 200) {
      const label = x.toString();
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(x - tw / 2 - 2, 2, tw + 4, 20);
      ctx.fillStyle = 'rgba(255, 50, 50, 1.0)';
      ctx.fillText(label, x - tw / 2, 17);
    }

    // Edge labels for Y axis (left)
    for (let y = 200; y < h; y += 200) {
      const label = y.toString();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(2, y - 18, 50, 20);
      ctx.fillStyle = 'rgba(255, 50, 50, 1.0)';
      ctx.fillText(label, 5, y - 2);
    }

    ctx.restore();
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
