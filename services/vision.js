// OpenRouter Vision AI Service
// Two modes:
//   1. Vision mode (default) — Claude Sonnet + downscaled screenshot, works with any app
//   2. Accessibility mode (optional, pixel-perfect) — when macOS Accessibility permission is granted

const AX_THRESHOLD = 15; // Below this = poor accessibility, use vision fallback
const FALLBACK_MAX_DIM = 1280; // Downscale screenshots to this max dimension for better AI accuracy

class VisionService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = 'openai/gpt-4o';
    this.conversationHistory = [];
    this.maxHistory = 10;
  }

  async analyze(screenshotBase64, question, screenshotWidth, screenshotHeight, elements) {
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
    // Pass 1: full screenshot downscaled — get rough answer + approximate coordinates
    const { base64: scaledBase64, width: scaledW, height: scaledH } =
      await this.downscaleScreenshot(screenshotBase64, origWidth, origHeight, FALLBACK_MAX_DIM);

    const scaleX = origWidth / scaledW;
    const scaleY = origHeight / scaledH;

    console.log(`OraAI: Vision pass 1 — ${origWidth}x${origHeight} → ${scaledW}x${scaledH} (scale ${scaleX.toFixed(2)}x)`);

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

    const fallbackModel = 'anthropic/claude-sonnet-4';

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

    const response = await fetch(this.endpoint, {
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
    });

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

    // Parse pass 1 result
    const pass1 = this.parseClickyResponse(content, scaleX, scaleY);

    // If no point found (speak-only), return as-is
    if (pass1.type !== 'guide' || !pass1.steps?.length) {
      return pass1;
    }

    // Pass 2: crop around the rough coordinates and refine
    const roughX = pass1.steps[0].x;
    const roughY = pass1.steps[0].y;
    const spokenText = pass1.steps[0].instruction;

    console.log(`OraAI: Vision pass 1 rough → screen(${roughX},${roughY})`);

    try {
      const refined = await this.refineCoordinates(
        screenshotBase64, origWidth, origHeight,
        roughX, roughY, spokenText, fallbackModel
      );
      if (refined) {
        pass1.steps[0].x = refined.x;
        pass1.steps[0].y = refined.y;
        console.log(`OraAI: Vision pass 2 refined → screen(${refined.x},${refined.y})`);
      }
    } catch (e) {
      console.warn('OraAI: Pass 2 refinement failed, using pass 1 coordinates:', e.message);
    }

    return pass1;
  }

  // ──────────────────────────────────────────────
  //  Pass 2: Crop + refine coordinates
  // ──────────────────────────────────────────────

  async refineCoordinates(screenshotBase64, screenW, screenH, roughX, roughY, context, model) {
    // Crop a generous region around the rough point from the full-resolution screenshot
    // Use 40% of screen dimensions as crop size, minimum 800x600
    const cropW = Math.max(800, Math.round(screenW * 0.4));
    const cropH = Math.max(600, Math.round(screenH * 0.4));

    // Center the crop on the rough point, clamped to screen bounds
    const cropX = Math.max(0, Math.min(roughX - Math.round(cropW / 2), screenW - cropW));
    const cropY = Math.max(0, Math.min(roughY - Math.round(cropH / 2), screenH - cropH));

    console.log(`OraAI: Vision pass 2 — crop ${cropW}x${cropH} at (${cropX},${cropY}) from ${screenW}x${screenH}`);

    // Extract the crop from the full-resolution screenshot
    const cropBase64 = await this.cropScreenshot(screenshotBase64, cropX, cropY, cropW, cropH);

    // Downscale the crop to a reasonable size for the AI
    const { base64: scaledCrop, width: scaledCropW, height: scaledCropH } =
      await this.downscaleScreenshot(cropBase64, cropW, cropH, FALLBACK_MAX_DIM);

    const cropScaleX = cropW / scaledCropW;
    const cropScaleY = cropH / scaledCropH;

    const systemPrompt = `You are OraAI, a screen tutor. You are looking at a ZOOMED-IN portion of a user's screen.

The user's question was already answered. Your job is to find the EXACT position of the target element in this zoomed view.

The target element: "${context.substring(0, 200)}"

Look at this zoomed screenshot and find the exact element being described. Put a [POINT:x,y:label] tag at the PRECISE CENTER of that element.

COORDINATE RULES:
- This zoomed image is ${scaledCropW} pixels wide and ${scaledCropH} pixels tall
- (0,0) is the top-left of this crop, (${scaledCropW},${scaledCropH}) is bottom-right
- Be VERY precise — this is a close-up view, accuracy matters
- Target the exact center of the button, icon, or text field`;

    const userMessage = {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${scaledCrop}` } },
        { type: 'text', text: `Zoomed screenshot (${scaledCropW}x${scaledCropH}px). Find the exact element and mark it with [POINT:x,y:label].` },
      ],
    };

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://oraai.app',
        'X-Title': 'OraAI',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, userMessage],
        max_tokens: 256,
        temperature: 0.2,
      }),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';
    const pointMatch = reply.match(/\[POINT:(\d+),(\d+)(?::([^\]]*))?\]/);

    if (!pointMatch) return null;

    const cropImgX = parseInt(pointMatch[1]);
    const cropImgY = parseInt(pointMatch[2]);

    // Map: crop image coords → crop pixel coords → screen coords
    const screenX = cropX + Math.round(cropImgX * cropScaleX);
    const screenY = cropY + Math.round(cropImgY * cropScaleY);

    return { x: screenX, y: screenY };
  }

  // ──────────────────────────────────────────────
  //  Crop a region from a base64 screenshot
  // ──────────────────────────────────────────────

  async cropScreenshot(base64, x, y, w, h) {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = `data:image/jpeg;base64,${base64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return dataUrl.split(',')[1];
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

    const response = await fetch(this.endpoint, {
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
    });

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

  parseClickyResponse(content, scaleX, scaleY) {
    // Extract [POINT:x,y:label] or [POINT:x,y] from the response
    const pointMatch = content.match(/\[POINT:(\d+),(\d+)(?::([^\]]*))?\]/);

    if (pointMatch) {
      const imgX = parseInt(pointMatch[1]);
      const imgY = parseInt(pointMatch[2]);
      const label = pointMatch[3] || 'target';

      // Scale from downscaled image coords to full screen coords
      // Clamp to image bounds first
      const clampedX = Math.max(0, Math.min(imgX, Math.round(1280))); // max dim
      const clampedY = Math.max(0, Math.min(imgY, Math.round(1280)));
      const screenX = Math.round(clampedX * scaleX);
      const screenY = Math.round(clampedY * scaleY);

      console.log(`OraAI: Clicky fallback — [POINT:${imgX},${imgY}:${label}] → screen(${screenX},${screenY}) [scale ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}]`);

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
  //  Downscale screenshot to max dimension
  // ──────────────────────────────────────────────

  async downscaleScreenshot(base64, origW, origH, maxDim) {
    // If already small enough, return as-is
    if (origW <= maxDim && origH <= maxDim) {
      return { base64, width: origW, height: origH };
    }

    const scale = maxDim / Math.max(origW, origH);
    const newW = Math.round(origW * scale);
    const newH = Math.round(origH * scale);

    // Use an offscreen canvas to resize
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
    return {
      base64: dataUrl.split(',')[1],
      width: newW,
      height: newH,
    };
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
