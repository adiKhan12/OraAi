// OraAI Orb Renderer — Canvas 2D with layered glow, particles, and state-driven animation

class OrbRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Position (screen coords)
    this.x = 0;
    this.y = 0;
    this.targetX = 0;
    this.targetY = 0;

    // Spring physics for smooth following
    this.velX = 0;
    this.velY = 0;
    this.spring = 0.12;
    this.damping = 0.7;

    // Orb properties
    this.baseRadius = 14;
    this.radius = this.baseRadius;
    this.targetRadius = this.baseRadius;
    this.opacity = 0.9;

    // State
    this.state = OrbState.IDLE;
    this.stateTime = 0;
    this.time = 0;

    // Particles (for guiding trail)
    this.particles = [];

    // Audio level (0-1) for listening visualization
    this.audioLevel = 0;

    // Guide mode: don't follow mouse
    this.followMouse = true;

    // Working area border
    this.workingArea = { enabled: false, width: 1280, height: 900, showBorder: true, resizing: false };
    this.lockedRect = null; // Locked position during resize mode

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = window.innerWidth * this.dpr;
    this.canvas.height = window.innerHeight * this.dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setMousePosition(x, y) {
    if (this.followMouse) {
      this.targetX = x;
      this.targetY = y;
    }
  }

  setGuideTarget(x, y) {
    this.followMouse = false;
    this.targetX = x;
    this.targetY = y;
  }

  returnToMouse() {
    this.followMouse = true;
  }

  setState(state) {
    this.state = state;
    this.stateTime = 0;

    switch (state) {
      case OrbState.IDLE:
        this.targetRadius = this.baseRadius;
        this.followMouse = true;
        break;
      case OrbState.LISTENING:
        this.targetRadius = this.baseRadius * 1.3;
        break;
      case OrbState.THINKING:
        this.targetRadius = this.baseRadius * 1.1;
        break;
      case OrbState.GUIDING:
        this.targetRadius = this.baseRadius * 1.5;
        break;
    }
  }

  setAudioLevel(level) {
    this.audioLevel = level;
  }

  update(dt) {
    this.time += dt;
    this.stateTime += dt;

    // Spring physics toward target
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    this.velX += dx * this.spring;
    this.velY += dy * this.spring;
    this.velX *= this.damping;
    this.velY *= this.damping;
    this.x += this.velX;
    this.y += this.velY;

    // Smooth radius transition
    this.radius += (this.targetRadius - this.radius) * 0.1;

    // Spawn particles in guiding mode (cap at 80 for performance)
    if (this.state === OrbState.GUIDING && Math.random() < 0.4 && this.particles.length < 80) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * 10,
        y: this.y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        life: 1,
        decay: 0.01 + Math.random() * 0.02,
        size: 2 + Math.random() * 3,
      });
    }

    // Update particles
    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      return p.life > 0;
    });
  }

  setWorkingArea(wa) {
    const wasResizing = this.workingArea.resizing;
    this.workingArea = { ...this.workingArea, ...wa };

    // Lock position when entering resize mode, unlock when leaving
    if (wa.resizing && !wasResizing) {
      const rect = this._calcWorkingAreaRect();
      this.lockedRect = { left: rect.left, top: rect.top };
    } else if (!wa.resizing && wasResizing) {
      this.lockedRect = null;
    }
  }

  _calcWorkingAreaRect() {
    const w = this.workingArea.width;
    const h = this.workingArea.height;
    const cx = this.followMouse ? this.targetX : this.x;
    const cy = this.followMouse ? this.targetY : this.y;
    const screenW = this.canvas.width / this.dpr;
    const screenH = this.canvas.height / this.dpr;
    const left = Math.max(0, Math.min(cx - w / 2, screenW - w));
    const top = Math.max(0, Math.min(cy - h / 2, screenH - h));
    return { left, top, width: w, height: h };
  }

  getWorkingAreaRect() {
    // During resize, use locked top-left but current size
    if (this.lockedRect) {
      return {
        left: this.lockedRect.left,
        top: this.lockedRect.top,
        width: this.workingArea.width,
        height: this.workingArea.height,
      };
    }
    return this._calcWorkingAreaRect();
  }

  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width / this.dpr, this.canvas.height / this.dpr);

    // Draw working area border
    if (this.workingArea.enabled && this.workingArea.showBorder) {
      this.drawWorkingAreaBorder(ctx);
    }

    // Draw particles first (behind orb)
    this.drawParticles(ctx);

    // Draw state-specific effects
    switch (this.state) {
      case OrbState.IDLE:
        this.drawIdle(ctx);
        break;
      case OrbState.LISTENING:
        this.drawListening(ctx);
        break;
      case OrbState.THINKING:
        this.drawThinking(ctx);
        break;
      case OrbState.GUIDING:
        this.drawGuiding(ctx);
        break;
    }
  }

  // --- IDLE: Soft breathing glow ---
  drawIdle(ctx) {
    const breathe = Math.sin(this.time * 1.5) * 0.15 + 1;
    const r = this.radius * breathe;

    // Outer glow
    const glow = ctx.createRadialGradient(this.x, this.y, r * 0.2, this.x, this.y, r * 3);
    glow.addColorStop(0, 'rgba(120, 100, 255, 0.25)');
    glow.addColorStop(0.5, 'rgba(120, 100, 255, 0.08)');
    glow.addColorStop(1, 'rgba(120, 100, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // Core orb
    const core = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    core.addColorStop(0, 'rgba(180, 170, 255, 0.95)');
    core.addColorStop(0.6, 'rgba(120, 100, 255, 0.8)');
    core.addColorStop(1, 'rgba(90, 70, 220, 0.3)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright spot
    const bright = ctx.createRadialGradient(this.x - r * 0.2, this.y - r * 0.2, 0, this.x, this.y, r * 0.6);
    bright.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
    bright.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- LISTENING: Warm amber pulse with expanding rings ---
  drawListening(ctx) {
    const pulse = Math.sin(this.time * 3) * 0.1 + 1;
    const audioBoost = 1 + this.audioLevel * 0.5;
    const r = this.radius * pulse * audioBoost;

    // Expanding rings
    for (let i = 0; i < 3; i++) {
      const ringPhase = ((this.stateTime * 0.8) + i * 0.33) % 1;
      const ringR = r + ringPhase * 50;
      const ringAlpha = (1 - ringPhase) * 0.3;
      ctx.strokeStyle = `rgba(255, 180, 60, ${ringAlpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, ringR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer glow — amber
    const glow = ctx.createRadialGradient(this.x, this.y, r * 0.2, this.x, this.y, r * 3.5);
    glow.addColorStop(0, 'rgba(255, 160, 40, 0.35)');
    glow.addColorStop(0.5, 'rgba(255, 130, 20, 0.12)');
    glow.addColorStop(1, 'rgba(255, 100, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Core — warm amber
    const core = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    core.addColorStop(0, 'rgba(255, 220, 140, 0.95)');
    core.addColorStop(0.5, 'rgba(255, 160, 40, 0.85)');
    core.addColorStop(1, 'rgba(220, 100, 20, 0.4)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Audio waveform ring
    if (this.audioLevel > 0.01) {
      ctx.strokeStyle = `rgba(255, 200, 100, ${0.4 + this.audioLevel * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        const wave = Math.sin(a * 6 + this.time * 8) * this.audioLevel * 8;
        const wr = r * 1.4 + wave;
        const wx = this.x + Math.cos(a) * wr;
        const wy = this.y + Math.sin(a) * wr;
        a === 0 ? ctx.moveTo(wx, wy) : ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  // --- THINKING: Color-cycling spinner with particle ring ---
  drawThinking(ctx) {
    const r = this.radius;
    const hue = (this.stateTime * 80) % 360;

    // Spinning particles in a ring
    const particleCount = 12;
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + this.stateTime * 3;
      const pr = r * 2.2;
      const px = this.x + Math.cos(angle) * pr;
      const py = this.y + Math.sin(angle) * pr;
      const alpha = 0.3 + Math.sin(this.stateTime * 5 + i) * 0.2;
      const pSize = 3 + Math.sin(this.stateTime * 4 + i * 0.5) * 1.5;

      ctx.fillStyle = `hsla(${(hue + i * 30) % 360}, 80%, 70%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // Outer glow — shifting color
    const glow = ctx.createRadialGradient(this.x, this.y, r * 0.2, this.x, this.y, r * 3);
    glow.addColorStop(0, `hsla(${hue}, 70%, 60%, 0.3)`);
    glow.addColorStop(1, `hsla(${hue}, 70%, 60%, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 3, 0, Math.PI * 2);
    ctx.fill();

    // Core — morphing
    const wobble1 = Math.sin(this.stateTime * 4) * 2;
    const wobble2 = Math.cos(this.stateTime * 3.5) * 2;
    const core = ctx.createRadialGradient(this.x + wobble1, this.y + wobble2, 0, this.x, this.y, r);
    core.addColorStop(0, `hsla(${hue}, 80%, 85%, 0.95)`);
    core.addColorStop(0.6, `hsla(${(hue + 40) % 360}, 70%, 60%, 0.8)`);
    core.addColorStop(1, `hsla(${(hue + 80) % 360}, 60%, 50%, 0.3)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- GUIDING: Bright gold, larger, with trail ---
  drawGuiding(ctx) {
    const pulse = Math.sin(this.time * 2) * 0.08 + 1;
    const r = this.radius * pulse;

    // Large outer glow — gold/purple
    const glow = ctx.createRadialGradient(this.x, this.y, r * 0.3, this.x, this.y, r * 4);
    glow.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
    glow.addColorStop(0.4, 'rgba(168, 85, 247, 0.15)');
    glow.addColorStop(1, 'rgba(120, 60, 200, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 4, 0, Math.PI * 2);
    ctx.fill();

    // Core — bright gold/white
    const core = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
    core.addColorStop(0.3, 'rgba(200, 160, 255, 0.9)');
    core.addColorStop(0.7, 'rgba(168, 85, 247, 0.7)');
    core.addColorStop(1, 'rgba(120, 50, 200, 0.2)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Pulsing ring
    const ringAlpha = 0.3 + Math.sin(this.time * 4) * 0.15;
    ctx.strokeStyle = `rgba(168, 85, 247, ${ringAlpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r * 1.8, 0, Math.PI * 2);
    ctx.stroke();
  }

  // --- Working area border ---
  drawWorkingAreaBorder(ctx) {
    const { left, top, width, height } = this.getWorkingAreaRect();

    // Dim area outside the working area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    const screenW = this.canvas.width / this.dpr;
    const screenH = this.canvas.height / this.dpr;
    // Top strip
    ctx.fillRect(0, 0, screenW, top);
    // Bottom strip
    ctx.fillRect(0, top + height, screenW, screenH - top - height);
    // Left strip
    ctx.fillRect(0, top, left, height);
    // Right strip
    ctx.fillRect(left + width, top, screenW - left - width, height);

    // Border
    ctx.strokeStyle = this.workingArea.resizing
      ? 'rgba(168, 85, 247, 0.8)'
      : 'rgba(168, 85, 247, 0.35)';
    ctx.lineWidth = this.workingArea.resizing ? 2 : 1;
    ctx.setLineDash(this.workingArea.resizing ? [] : [8, 6]);
    ctx.strokeRect(left, top, width, height);
    ctx.setLineDash([]);

    // Size label in resize mode
    if (this.workingArea.resizing) {
      const label = `${width} × ${height}`;
      ctx.font = '13px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.fillStyle = 'rgba(168, 85, 247, 0.9)';
      ctx.fillText(label, left + 8, top + 20);
    }
  }

  // --- Particle trail ---
  drawParticles(ctx) {
    for (const p of this.particles) {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      grad.addColorStop(0, `rgba(168, 85, 247, ${p.life * 0.6})`);
      grad.addColorStop(1, `rgba(168, 85, 247, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- Animation loop ---
  tick(timestamp) {
    const dt = Math.min((timestamp - (this.lastTime || timestamp)) / 1000, 0.1);
    this.lastTime = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.tick(t));
  }

  start() {
    requestAnimationFrame((t) => this.tick(t));
  }
}
