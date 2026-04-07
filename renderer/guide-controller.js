// Guide Controller — orchestrates orb movement through AI steps + tooltips

class GuideController {
  constructor(orbRenderer, ttsService) {
    this.orb = orbRenderer;
    this.tts = ttsService;
    this.tooltipContainer = document.getElementById('tooltip-container');
    this.isGuiding = false;
    this.aborted = false;
  }

  async runGuide(response, screenshotInfo) {
    if (!response?.steps?.length) return;

    this.isGuiding = true;
    this.aborted = false;
    this.clearTooltips();

    // Window starts at y=31 (below menu bar). Canvas y=0 = screen y=31.
    // Screenshot covers full screen (y=0 to y=1200).
    // AI pixel coords are in screenshot space.
    // To map to canvas: subtract window Y offset (31px).
    const screenInfo = await window.oraAPI.getScreenInfo();
    const winOffsetY = 31; // Menu bar height — from debug: winBounds.y=31
    console.log(`OraAI Guide: screenshot ${screenshotInfo.width}x${screenshotInfo.height}, canvas ${window.innerWidth}x${window.innerHeight}, winY=${winOffsetY}`);

    // Process each step (no pre-speech — go straight to guiding)
    for (let i = 0; i < response.steps.length; i++) {
      if (this.aborted) break;

      const step = response.steps[i];

      // Map screenshot coords → canvas coords (subtract window Y offset)
      const screenX = step.x;
      const screenY = step.y - winOffsetY;

      console.log(`OraAI Guide step ${i + 1}: AI(${step.x},${step.y}) → canvas(${screenX},${screenY})`);

      // Clear previous step's tooltip and rings
      this.clearTooltips();

      // Animate orb to target position
      this.orb.setGuideTarget(screenX, screenY);

      // Wait for orb to arrive
      await this.waitForOrbArrival(screenX, screenY, 1500);
      if (this.aborted) break;

      // Show tooltip and target ring for THIS step only
      this.showTooltip(screenX, screenY, step.instruction, i + 1, response.steps.length);
      this.showTargetRing(screenX, screenY);

      // Speak the instruction
      try {
        await this.tts.speak(step.instruction);
      } catch (e) {
        console.warn(`TTS step ${i + 1} failed:`, e);
        await this.sleep(step.delay_after * 1000 || 2000);
      }

      if (this.aborted) break;

      // Brief pause after speaking
      await this.sleep(600);
    }

    this.finish();
  }

  waitForOrbArrival(targetX, targetY, maxWait) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        const dx = this.orb.x - targetX;
        const dy = this.orb.y - targetY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 5 || Date.now() - start > maxWait) {
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
  }

  showTooltip(x, y, text, stepNumber, totalSteps) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tooltip';
    tooltip.innerHTML = `<span class="step-number">${stepNumber}</span><span class="step-text">${text}</span><span class="step-count">${stepNumber}/${totalSteps}</span>`;

    // Position tooltip offset from the target
    const offsetX = 35;
    const offsetY = -20;
    let left = x + offsetX;
    let top = y + offsetY;

    // Keep tooltip on screen
    const maxW = window.innerWidth - 320;
    const maxH = window.innerHeight - 60;
    if (left > maxW) left = x - 320;
    if (top > maxH) top = maxH;
    if (top < 10) top = 10;
    if (left < 10) left = 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
    this.tooltipContainer.appendChild(tooltip);

    // Animate in
    requestAnimationFrame(() => {
      tooltip.classList.add('visible');
    });
  }

  showTargetRing(x, y) {
    const ring = document.createElement('div');
    ring.className = 'target-ring';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    this.tooltipContainer.appendChild(ring);

    setTimeout(() => {
      if (this.aborted) return;
      const ring2 = document.createElement('div');
      ring2.className = 'target-ring';
      ring2.style.left = x + 'px';
      ring2.style.top = y + 'px';
      ring2.style.animationDelay = '0.5s';
      this.tooltipContainer.appendChild(ring2);
    }, 200);
  }

  clearTooltips() {
    this.tooltipContainer.innerHTML = '';
  }

  abort() {
    this.aborted = true;
    this.tts.stopCurrent();
  }

  finish() {
    this.isGuiding = false;
    setTimeout(() => {
      const tooltips = this.tooltipContainer.querySelectorAll('.tooltip');
      tooltips.forEach((t) => t.classList.remove('visible'));
      setTimeout(() => this.clearTooltips(), 400);
    }, 2000);

    this.orb.returnToMouse();
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
