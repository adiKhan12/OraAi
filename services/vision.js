// OpenRouter Vision AI Service
// Two modes:
//   1. Vision mode (default) — Claude Sonnet + downscaled screenshot, works with any app
//   2. Accessibility mode (optional, pixel-perfect) — when macOS Accessibility permission is granted

const AX_THRESHOLD = 15; // Below this = poor accessibility, use vision fallback
// Anthropic-recommended resolution — Claude is calibrated for this
const TARGET_W = 1280;
const TARGET_H = 800;
const API_TIMEOUT_MS = 30000; // 30s timeout for vision API calls

class VisionService {
  constructor(apiKey, visionModel) {
    this.apiKey = apiKey;
    this.endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = visionModel || 'anthropic/claude-sonnet-4.6';
    this.conversationHistory = [];
    this.maxHistory = 10;
    console.log(`OraAI: Vision model = ${this.model}`);
  }

  async analyze(screenshotBase64, question, screenshotWidth, screenshotHeight, elements, screenshotMeta) {
    this.screenshotMeta = screenshotMeta || {}; // { cropOffsetScreen, screenWidth, screenHeight, scaleFactor }
    // Filter out noise elements (menu bar items with no useful context)
    const usefulElements = (elements || []).filter(
      (e) => e.role !== 'MenuBarItem' && e.role !== 'MenuItem'
    );

    const useAccessibility = usefulElements.length >= AX_THRESHOLD;

    console.log(`OraAI: Mode=${useAccessibility ? 'ACCESSIBILITY' : 'VISION_FALLBACK'} (${usefulElements.length} useful elements)`);

    if (useAccessibility) {
      return this.analyzeWithAccessibility(screenshotBase64, question, elements);
    } else {
      return this.analyzeWithVisionFallback(screenshotBase64, question, screenshotWidth, screenshotHeight);
    }
  }

  // ──────────────────────────────────────────────
  //  MODE 1: Accessibility (pixel-perfect)
  // ──────────────────────────────────────────────

  async analyzeWithAccessibility(screenshotBase64, question, elements) {
    const elementList = (elements || [])
      .map((e) => `[${e.id}] ${e.role}: "${e.label}" at (${e.x},${e.y}) size ${e.w}x${e.h}`)
      .join('\n');

    const systemPrompt = `You are OraAI, a friendly and knowledgeable screen tutor. You can see the user's screen and know all UI elements.

You have TWO sources:
1. A screenshot of the screen
2. A list of UI elements with EXACT positions from the OS

UI ELEMENTS:
${elementList}

DECIDE the response type:
- If the user asks about something ON SCREEN (where to click, how to use the app) → type: "guide"
- If the user asks a GENERAL question → type: "speak"

For "guide" responses:
{"type":"guide","steps":[{"instruction":"spoken text","element_id":5,"action":"click","delay_after":2}]}

For "speak" responses:
{"type":"speak","answer":"Your conversational answer here"}

INSTRUCTION QUALITY:
- Speak like a friendly tutor, not a robot
- BAD: "Click on 'Add text'" — too terse
- GOOD: "Let's click this button here — it will open the text editor for you"
- Explain what will happen after each action
- For multi-step tasks, connect steps logically
- Adapt your language to whatever app is on screen

Rules:
- ALWAYS use element_id when the target is in the element list
- If element isn't in the list, use x,y coordinates
- Actions: click, type, scroll, look
- Max 8 steps
- Respond ONLY with JSON`;

    return this.callAPI(systemPrompt, screenshotBase64, question, (content) => {
      return this.parseAccessibilityResponse(content, elements);
    });
  }

  // ──────────────────────────────────────────────
  //  MODE 2: Vision Fallback (Clicky-style)
  //  Downscaled screenshot + coordinate extraction
  // ──────────────────────────────────────────────

  async analyzeWithVisionFallback(screenshotBase64, question, origWidth, origHeight) {
    // Resize to Anthropic-recommended resolution for best coordinate accuracy
    // Cropped images → force to 1280×800 (Claude is calibrated for this)
    // Full screen → scale width to 1280, preserve aspect ratio (Clicky-style)
    const isCropped = !!(this.screenshotMeta?.cropOffsetScreen || this.screenshotMeta?.displayOffsetX);
    const { base64: scaledBase64, width: scaledW, height: scaledH } = isCropped
      ? await this.resizeToExact(screenshotBase64, TARGET_W, TARGET_H)
      : await this.resizeToWidth(screenshotBase64, origWidth, origHeight, TARGET_W);

    console.log(`OraAI: Vision fallback — ${origWidth}x${origHeight} → ${scaledW}x${scaledH} (${isCropped ? 'crop→forced' : 'fullscreen→proportional'})`);

    // Clicky-style system prompt: natural text response with [POINT:x,y:label] at the end
    const systemPrompt = `You are OraAI, a friendly screen tutor that helps users navigate applications on their Mac.

You will receive a screenshot of the user's current screen. The user will ask you a question about what they see.

If the question is about the screen (where to click, how to do something in the app):
- Give a natural, helpful spoken response explaining what to do
- At the END of your response, include a [POINT:x,y:label] tag marking exactly where the user should look or click
- The coordinates x,y are pixel positions in the screenshot image
- Only include ONE point per response — the most important next action

If the question is general knowledge (not about the screen):
- Just give a normal helpful answer, no [POINT] tag needed

COORDINATE RULES:
- The screenshot is exactly ${scaledW} pixels wide and ${scaledH} pixels tall
- (0,0) is top-left, (${scaledW},${scaledH}) is bottom-right
- Look VERY carefully at the actual position of UI elements before giving coordinates
- Target the exact CENTER of buttons, text fields, icons — not the edge
- x=${Math.round(scaledW/2)} is the horizontal middle of the screen

Example response for a screen question:
"To search for something, you'll want to click on the search bar at the top of the page. Just click right here and start typing what you're looking for. [POINT:${Math.round(scaledW/2)},85:search bar]"

Example response for a general question:
"JavaScript is a programming language used for web development. It runs in browsers and can also be used on servers with Node.js."`;

    const fallbackModel = this.model;

    const userMessage = {
      role: 'user',
      content: [
        { type: 'text', text: `(image dimensions: ${scaledW}x${scaledH} pixels)\n\n${question}` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${scaledBase64}` } },
      ],
    };

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      userMessage,
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://oraai.app',
          'X-Title': 'OraAI',
        },
        body: JSON.stringify({
          model: fallbackModel,
          messages,
          max_tokens: 1024,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Vision request timed out — try again');
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vision fallback failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Save to history
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content });
    while (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory.shift();
    }

    // Parse the [POINT:x,y:label] from the response
    return this.parseClickyResponse(content, scaledW, scaledH);
  }

  // ──────────────────────────────────────────────
  //  Shared API call with conversation history
  // ──────────────────────────────────────────────

  async callAPI(systemPrompt, screenshotBase64, question, parseFunc) {
    const userMessage = {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
        { type: 'text', text: question },
      ],
    };

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      userMessage,
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://oraai.app',
          'X-Title': 'OraAI',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: 1024,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Vision request timed out — try again');
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vision API failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Save to history (text only)
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content });
    while (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory.shift();
    }

    return parseFunc(content);
  }

  // ──────────────────────────────────────────────
  //  Parse: Accessibility mode
  // ──────────────────────────────────────────────

  parseAccessibilityResponse(content, elements) {
    let parsed = this.extractJSON(content);

    if (!parsed?.steps && parsed?.type !== 'speak') {
      return { type: 'speak', answer: content.substring(0, 300) };
    }

    if (parsed.type === 'speak') return parsed;

    const elementMap = {};
    (elements || []).forEach((e) => { elementMap[e.id] = e; });

    parsed.steps = (parsed.steps || []).map((step) => {
      let x = step.x || 960;
      let y = step.y || 600;

      if (step.element_id && elementMap[step.element_id]) {
        const el = elementMap[step.element_id];
        x = el.x;
        y = el.y;
        console.log(`OraAI: Step "${step.instruction}" → [${el.id}] "${el.label}" at (${x},${y}) ← PIXEL PERFECT`);
      }

      return {
        instruction: step.instruction || 'Look here',
        x, y,
        action: step.action || 'look',
        delay_after: step.delay_after || 2,
      };
    });

    return parsed;
  }

  // ──────────────────────────────────────────────
  //  Parse: Clicky-style [POINT:x,y:label] from natural text
  // ──────────────────────────────────────────────

  parseClickyResponse(content, scaledW, scaledH) {
    // Extract [POINT:x,y:label] or [POINT:x,y] from the response
    const pointMatch = content.match(/\[POINT:(\d+),(\d+)(?::([^\]]*))?\]/);

    if (pointMatch) {
      const imgX = parseInt(pointMatch[1]);
      const imgY = parseInt(pointMatch[2]);
      const label = pointMatch[3] || 'target';

      // Clamp to the downscaled image bounds
      const clampedX = Math.max(0, Math.min(imgX, scaledW));
      const clampedY = Math.max(0, Math.min(imgY, scaledH));

      // Like Clicky: map AI coords → screen points in one ratio
      // screenPoint = AI_coord × (displayRegion / scaledImage) + displayOffset
      const meta = this.screenshotMeta || {};
      const displayW = meta.displayRegionW || window.innerWidth;
      const displayH = meta.displayRegionH || window.innerHeight;
      const offsetX = meta.displayOffsetX || 0;
      const offsetY = meta.displayOffsetY || 0;

      const screenX = Math.round(clampedX * (displayW / scaledW) + offsetX);
      const screenY = Math.round(clampedY * (displayH / scaledH) + offsetY);

      console.log(`OraAI: Clicky — [POINT:${imgX},${imgY}:${label}] → screenPt(${screenX},${screenY}) [img=${scaledW}x${scaledH} region=${displayW}x${displayH} offset=${offsetX},${offsetY}]`);

      // Clean the [POINT:...] tag from spoken text
      const spokenText = content.replace(/\s*\[POINT:\d+,\d+(?::[^\]]*)?\]\s*/g, '').trim();

      return {
        type: 'guide',
        steps: [{
          instruction: spokenText,
          x: screenX,
          y: screenY,
          action: 'click',
          delay_after: 2,
        }],
      };
    }

    // No [POINT] found — this is a speak-only response
    console.log('OraAI: Clicky fallback — no POINT found, speak-only response');
    return {
      type: 'speak',
      answer: content,
    };
  }

  // ──────────────────────────────────────────────
  //  Resize strategies for AI coordinate accuracy
  // ──────────────────────────────────────────────

  // Force to exact dimensions (for cropped images → Anthropic 1280×800)
  async resizeToExact(base64, targetW, targetH) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:image/jpeg;base64,${base64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1], width: targetW, height: targetH };
  }

  // Scale to target width, preserve aspect ratio (for full-screen → Clicky-style)
  async resizeToWidth(base64, origW, origH, targetW) {
    if (origW <= targetW) {
      return { base64, width: origW, height: origH };
    }

    const scale = targetW / origW;
    const newW = targetW;
    const newH = Math.round(origH * scale);

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:image/jpeg;base64,${base64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, newW, newH);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1], width: newW, height: newH };
  }

  // ──────────────────────────────────────────────
  //  MODE 3: Agent Mode — reactive loop, single action per call
  // ──────────────────────────────────────────────

  async agentStep(screenshotBase64, userRequest, origWidth, origHeight, screenshotMeta, externalSignal) {
    this.screenshotMeta = screenshotMeta || {};

    const { base64: scaledBase64, width: scaledW, height: scaledH } =
      await this.resizeToWidth(screenshotBase64, origWidth, origHeight, TARGET_W);

    console.log(`OraAI: Agent step — ${origWidth}x${origHeight} → ${scaledW}x${scaledH}`);

    const systemPrompt = `You are OraAI Agent, controlling the user's macOS desktop. You see screenshots and decide the SINGLE next action to complete the user's request.

USER'S REQUEST: ${userRequest}

AVAILABLE ACTIONS (return exactly ONE):
{"action":"click","x":640,"y":400,"says":"I'll click this for you"}
{"action":"doubleclick","x":640,"y":400,"says":"Opening this..."}
{"action":"rightclick","x":640,"y":400,"says":"Opening menu..."}
{"action":"type","text":"hello world","says":"Typing this"}
{"action":"key","key":"return","says":"Pressing Enter"}
{"action":"scroll","dy":-300,"says":"Scrolling down"}
{"action":"wait","ms":2000,"says":"Waiting for the app to load..."}
{"action":"done","says":"All done! Here's what happened..."}

COORDINATES: This screenshot is ${scaledW}x${scaledH} pixels. (0,0)=top-left, (${scaledW},${scaledH})=bottom-right. Look very carefully at UI positions.

KEYS: return, enter, escape, tab, space, backspace, delete, up, down, left, right, pageup, pagedown, home, end
MODIFIER+KEY: cmd+c, cmd+v, cmd+a, cmd+z, cmd+x, cmd+t, cmd+w, cmd+q, cmd+tab, shift+tab

RULES:
1. Return ONLY valid JSON — one action per response. No explanation outside JSON.
2. Think step by step: what is the SINGLE best next action?
3. If the screen is loading or changing, use "wait" to let it settle.
4. When the user's request is fully complete, use "done".
5. If something went wrong or you're stuck, use "done" with an explanation in "says".
6. For click/doubleclick/rightclick, the x,y must be the CENTER of the target element.
7. For scroll, positive dy=down, negative dy=up.`;

    const userMessage = {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${scaledBase64}` } },
        { type: 'text', text: 'Next action?' },
      ],
    };

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      userMessage,
    ];

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), API_TIMEOUT_MS);
    const combinedSignal = externalSignal
      ? AbortSignal.any([externalSignal, timeoutController.signal])
      : timeoutController.signal;

    let response;
    try {
      response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://oraai.app',
          'X-Title': 'OraAI',
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: 512,
          temperature: 0.2,
        }),
        signal: combinedSignal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Agent request timed out');
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent API failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    this.conversationHistory.push({ role: 'user', content: 'Next action?' });
    this.conversationHistory.push({ role: 'assistant', content });
    while (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory.shift();
    }

    return this.parseAgentResponse(content, scaledW, scaledH);
  }

  parseAgentResponse(content, scaledW, scaledH) {
    let parsed = this.extractJSON(content);

    if (!parsed || !parsed.action) {
      console.warn('OraAI: Agent fallback — no valid action, treating as done');
      return { action: 'done', says: content.substring(0, 200) };
    }

    if (parsed.action === 'done' || parsed.action === 'wait') {
      return parsed;
    }

    if (parsed.action === 'type' || parsed.action === 'key') {
      return parsed;
    }

    if (parsed.action === 'scroll') {
      parsed.dx = parsed.dx || 0;
      parsed.dy = parsed.dy || 0;
      return parsed;
    }

    if (parsed.action === 'click' || parsed.action === 'doubleclick' || parsed.action === 'rightclick') {
      const imgX = Math.round(Number(parsed.x) || scaledW / 2);
      const imgY = Math.round(Number(parsed.y) || scaledH / 2);
      const clampedX = Math.max(0, Math.min(imgX, scaledW));
      const clampedY = Math.max(0, Math.min(imgY, scaledH));

      const meta = this.screenshotMeta || {};
      const displayW = meta.displayRegionW || window.innerWidth;
      const displayH = meta.displayRegionH || window.innerHeight;
      const offsetX = meta.displayOffsetX || 0;
      const offsetY = meta.displayOffsetY || 0;

      parsed.x = Math.round(clampedX * (displayW / scaledW) + offsetX);
      parsed.y = Math.round(clampedY * (displayH / scaledH) + offsetY);

      console.log(`OraAI: Agent click — image(${imgX},${imgY}) → screen(${parsed.x},${parsed.y}) [region=${displayW}x${displayH} offset=${offsetX},${offsetY}]`);
    }

    return parsed;
  }

  clearConversation() {
    this.conversationHistory = [];
  }

  // ──────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────

  extractJSON(content) {
    try {
      return JSON.parse(content.trim());
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch {}
      }
    }
    return null;
  }
}
