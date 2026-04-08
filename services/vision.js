// OpenRouter Vision AI Service
// Two modes:
//   1. Accessibility mode (pixel-perfect) — when OS provides rich element data
//   2. Vision fallback (Clicky-style) — downscaled screenshot + coordinate extraction

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
    // Downscale screenshot to 1280px max dimension for better AI coordinate accuracy
    const { base64: scaledBase64, width: scaledW, height: scaledH } =
      await this.downscaleScreenshot(screenshotBase64, origWidth, origHeight, FALLBACK_MAX_DIM);

    console.log(`OraAI: Vision fallback — downscaled ${origWidth}x${origHeight} → ${scaledW}x${scaledH}`);

    // Store scale factors for converting AI coords back to screen space
    this.lastScaleX = origWidth / scaledW;
    this.lastScaleY = origHeight / scaledH;

    const systemPrompt = `You are OraAI, a friendly and knowledgeable screen tutor. You can see the user's screen.

The screenshot you're looking at is ${scaledW}x${scaledH} pixels.

DECIDE the response type:
- If the user asks about something ON SCREEN → type: "guide"
- If the user asks a GENERAL question → type: "speak"

For "guide" responses, you MUST identify the exact pixel coordinates of each UI element to interact with. Return coordinates as [POINT:x,y] tags within each instruction.

Format:
{"type":"guide","steps":[{"instruction":"Let's click the search bar here to start searching [POINT:640,280]","action":"click","delay_after":2}]}

For "speak" responses:
{"type":"speak","answer":"Your conversational answer here"}

COORDINATE ACCURACY — this is critical:
- The image is exactly ${scaledW} pixels wide and ${scaledH} pixels tall
- (0,0) is the top-left corner, (${scaledW},${scaledH}) is the bottom-right
- Horizontal center is x=${Math.round(scaledW / 2)}
- Look carefully at where each UI element actually is before estimating coordinates
- Target the CENTER of the element, not the edge
- Double-check your coordinates by comparing to nearby reference points

INSTRUCTION QUALITY:
- Speak like a friendly tutor, not a robot
- Each instruction should be a natural sentence that includes the [POINT:x,y] tag
- Explain what will happen after each action
- For multi-step tasks, connect steps logically
- Adapt your language to whatever app is on screen

Rules:
- Every guide step MUST include a [POINT:x,y] tag with pixel coordinates
- Actions: click, type, scroll, look
- Max 8 steps
- Respond ONLY with JSON`;

    return this.callAPI(systemPrompt, scaledBase64, question, (content) => {
      return this.parseVisionFallbackResponse(content, this.lastScaleX, this.lastScaleY);
    });
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
  //  Parse: Vision fallback (extract [POINT:x,y])
  // ──────────────────────────────────────────────

  parseVisionFallbackResponse(content, scaleX, scaleY) {
    let parsed = this.extractJSON(content);

    if (!parsed?.steps && parsed?.type !== 'speak') {
      return { type: 'speak', answer: content.substring(0, 300) };
    }

    if (parsed.type === 'speak') return parsed;

    parsed.steps = (parsed.steps || []).map((step) => {
      const instruction = step.instruction || '';

      // Extract [POINT:x,y] from instruction text
      const pointMatch = instruction.match(/\[POINT:(\d+),(\d+)\]/);
      let x, y;

      if (pointMatch) {
        // Scale from downscaled image coords back to screen coords
        x = Math.round(parseInt(pointMatch[1]) * scaleX);
        y = Math.round(parseInt(pointMatch[2]) * scaleY);
        console.log(`OraAI: Vision fallback — [POINT:${pointMatch[1]},${pointMatch[2]}] → screen(${x},${y}) [scale ${scaleX.toFixed(2)}x${scaleY.toFixed(2)}]`);
      } else {
        // Try raw x,y from JSON
        x = step.x ? Math.round(step.x * scaleX) : 960;
        y = step.y ? Math.round(step.y * scaleY) : 600;
        console.log(`OraAI: Vision fallback — raw coords (${step.x},${step.y}) → screen(${x},${y})`);
      }

      // Clean the [POINT:...] tag from the spoken instruction
      const cleanInstruction = instruction.replace(/\s*\[POINT:\d+,\d+\]\s*/g, '').trim();

      return {
        instruction: cleanInstruction || 'Look here',
        x, y,
        action: step.action || 'look',
        delay_after: step.delay_after || 2,
      };
    });

    return parsed;
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
