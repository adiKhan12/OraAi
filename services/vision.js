// OpenRouter Vision AI Service — with Accessibility element grounding

class VisionService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = 'openai/gpt-4o';
    this.conversationHistory = []; // Preserves context across questions
    this.maxHistory = 10; // Keep last 10 exchanges
  }

  async analyze(screenshotBase64, question, screenshotWidth, screenshotHeight, elements) {
    // Build element list for the prompt
    const elementList = (elements || [])
      .map((e) => `[${e.id}] ${e.role}: "${e.label}" at (${e.x},${e.y}) size ${e.w}x${e.h}`)
      .join('\n');

    const systemPrompt = `You are OraAI, a friendly and knowledgeable screen tutor. You can see the user's screen and know all UI elements.

You have TWO sources:
1. A screenshot of the screen
2. A list of UI elements with EXACT positions from the OS

UI ELEMENTS:
${elementList || 'No elements detected'}

DECIDE the response type:
- If the user asks about something ON SCREEN (where to click, how to use the app, navigate UI) → type: "guide"
- If the user asks a GENERAL question (knowledge, coding help, conversation) → type: "speak"

For "guide" responses:
{"type":"guide","steps":[{"instruction":"spoken text","element_id":5,"action":"click","delay_after":2}],"summary":"overview"}

For "speak" responses:
{"type":"speak","answer":"Your conversational answer here"}

INSTRUCTION QUALITY — this is critical:
- Speak like a friendly tutor, not a robot
- BAD: "Click on 'Add text'" — too terse, no context
- GOOD: "Let's click this button here — it will open the text editor for you" — natural, explains what happens
- Each instruction should be a natural spoken sentence
- Explain what will happen after each action so the user understands the workflow
- For multi-step tasks, connect steps logically ("Great, now that we've done that, let's...")
- If the user asks HOW to do something, briefly explain the concept before guiding
- Adapt your language to whatever app is on screen — use its own terminology

Rules:
- ALWAYS use element_id when the target is in the element list
- If element isn't in the list, use x,y coordinates
- Actions: click, type, scroll, look
- Max 8 steps
- Respond ONLY with JSON`;

    // Build current user message with screenshot
    const userMessage = {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } },
        { type: 'text', text: question },
      ],
    };

    // Assemble messages: system + history + current
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

    // Save to history (text only — don't store screenshots to save tokens)
    this.conversationHistory.push({ role: 'user', content: question });
    this.conversationHistory.push({ role: 'assistant', content });

    // Trim history if too long
    while (this.conversationHistory.length > this.maxHistory * 2) {
      this.conversationHistory.shift();
    }

    return this.parseResponse(content, elements);
  }

  parseResponse(content, elements) {
    let parsed;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
    }

    if (!parsed?.steps) {
      return {
        steps: [{ instruction: content.substring(0, 200), x: 960, y: 600, action: 'look', delay_after: 3 }],
        summary: 'Here is what I found.',
      };
    }

    // Resolve element_id references to pixel coordinates
    const elementMap = {};
    (elements || []).forEach((e) => { elementMap[e.id] = e; });

    parsed.steps = parsed.steps.map((step) => {
      let x = step.x || 960;
      let y = step.y || 600;

      if (step.element_id && elementMap[step.element_id]) {
        const el = elementMap[step.element_id];
        x = el.x;
        y = el.y;
        console.log(`OraAI: Step "${step.instruction}" → element [${el.id}] "${el.label}" at (${x},${y}) ← PIXEL PERFECT`);
      } else if (step.element_id) {
        console.warn(`OraAI: element_id ${step.element_id} not found in element list`);
      }

      return {
        instruction: step.instruction || 'Look here',
        x,
        y,
        action: step.action || 'look',
        delay_after: step.delay_after || 2,
      };
    });

    return parsed;
  }
}
