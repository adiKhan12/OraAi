// Coordinate pipeline test — verifies AI pointing accuracy
// Usage: node tests/test-coordinates.js
//
// Uses the test-crop.jpg from debug folder, sends to AI,
// maps coordinates back, draws result on both crop and fullscreen images.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const envPath = process.platform === 'win32'
  ? path.join(require('os').homedir(), '.oraai', '.env')
  : '/mnt/c/Users/Administrator/.oraai/.env';
require('dotenv').config({ path: envPath });

const DEBUG_DIR = process.platform === 'win32'
  ? path.join(require('os').homedir(), '.oraai', 'debug')
  : '/mnt/c/Users/Administrator/.oraai/debug';
const FALLBACK_MAX_DIM = 1280;

// Test metadata from F3 capture
const CROP_META = {
  width: 1628, height: 1394,
  displayRegionW: 1628, displayRegionH: 1394,
  displayOffsetX: 1812, displayOffsetY: 0,
};
const FULLSCREEN = { width: 3440, height: 1440 };
const EXPECTED_SCREEN = { x: 3257, y: 752 }; // where the split terminal icon is
const QUESTION = 'How do I split the terminal here in Visual Studio Code? Which button or icon do I need to press?';

async function main() {
  console.log('=== OraAI Coordinate Pipeline Test ===\n');

  // 1. Load the crop image
  const cropPath = path.join(DEBUG_DIR, 'test-crop.jpg');
  if (!fs.existsSync(cropPath)) {
    console.error('Missing test-crop.jpg — press F3 in OraAI first');
    process.exit(1);
  }
  const cropBuffer = fs.readFileSync(cropPath);
  const cropBase64 = cropBuffer.toString('base64');
  console.log(`1. Loaded crop image: ${CROP_META.width}x${CROP_META.height}`);

  // 2. Downscale — try different strategies
  const strategy = process.argv[3] || 'anthropic'; // 'proportional', 'anthropic', 'fullscreen'
  let scaledW, scaledH, scaledBase64;

  if (strategy === 'anthropic') {
    // Force to Anthropic recommended resolution (1280x800)
    scaledW = 1280;
    scaledH = 800;
    const scaledBuffer = await sharp(cropBuffer)
      .resize(scaledW, scaledH, { fit: 'fill' }) // stretch to exact dims
      .jpeg({ quality: 85 })
      .toBuffer();
    scaledBase64 = scaledBuffer.toString('base64');
  } else if (strategy === 'anthropic-fit') {
    // Fit inside 1280x800 preserving aspect ratio (letterbox)
    scaledW = 1280;
    scaledH = 800;
    const scaledBuffer = await sharp(cropBuffer)
      .resize(scaledW, scaledH, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
      .jpeg({ quality: 85 })
      .toBuffer();
    scaledBase64 = scaledBuffer.toString('base64');
  } else if (strategy === 'fullscreen') {
    // Like Clicky: use full screen image, scale to 1280 max
    const fullPath = path.join(DEBUG_DIR, 'test-fullscreen.jpg');
    const fullBuffer = fs.readFileSync(fullPath);
    scaledW = 1280;
    scaledH = Math.round(FULLSCREEN.height * (1280 / FULLSCREEN.width));
    const scaledBuffer = await sharp(fullBuffer)
      .resize(scaledW, scaledH)
      .jpeg({ quality: 85 })
      .toBuffer();
    scaledBase64 = scaledBuffer.toString('base64');
  } else {
    // proportional: our current approach
    const scale = FALLBACK_MAX_DIM / Math.max(CROP_META.width, CROP_META.height);
    scaledW = Math.round(CROP_META.width * scale);
    scaledH = Math.round(CROP_META.height * scale);
    if (scale < 1) {
      const scaledBuffer = await sharp(cropBuffer)
        .resize(scaledW, scaledH)
        .jpeg({ quality: 85 })
        .toBuffer();
      scaledBase64 = scaledBuffer.toString('base64');
    } else {
      scaledBase64 = cropBase64;
    }
  }
  console.log(`2. Strategy: ${strategy} → ${scaledW}x${scaledH}`);

  // Save the downscaled image for reference
  fs.writeFileSync(path.join(DEBUG_DIR, 'test-downscaled.jpg'), Buffer.from(scaledBase64, 'base64'));

  // 3. Build prompt (same as vision.js)
  const systemPrompt = `You are OraAI, a friendly screen tutor that helps users navigate applications.

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
- x=${Math.round(scaledW / 2)} is the horizontal middle of the screen

Example response for a screen question:
"To search for something, you'll want to click on the search bar at the top of the page. Just click right here and start typing what you're looking for. [POINT:${Math.round(scaledW / 2)},85:search bar]"

Example response for a general question:
"JavaScript is a programming language used for web development. It runs in browsers and can also be used on servers with Node.js."`;

  // 4. Call AI
  // Override via CLI: node tests/test-coordinates.js anthropic/claude-sonnet-4.6
  const model = process.argv[2] || process.env.VISION_MODEL || 'qwen/qwen3.5-flash-02-23';
  console.log(`3. Calling AI (${model})...`);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://oraai.app',
      'X-Title': 'OraAI',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: `(image dimensions: ${scaledW}x${scaledH} pixels)\n\n${QUESTION}` },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${scaledBase64}` } },
          ],
        },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`AI error (${response.status}):`, err);
    process.exit(1);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  console.log(`4. AI response:\n   ${content}\n`);

  // 5. Parse [POINT:x,y:label]
  const pointMatch = content.match(/\[POINT:(\d+),(\d+)(?::([^\]]*))?\]/);
  if (!pointMatch) {
    console.error('No [POINT] found in response');
    process.exit(1);
  }

  const imgX = parseInt(pointMatch[1]);
  const imgY = parseInt(pointMatch[2]);
  const label = pointMatch[3] || 'target';
  console.log(`5. AI point: (${imgX}, ${imgY}) — "${label}" (in ${scaledW}x${scaledH} image space)`);

  // 6. Map to screen points — THE KEY FORMULA
  // screenPoint = AI_coord × (displayRegion / scaledImage) + displayOffset
  const clampedX = Math.max(0, Math.min(imgX, scaledW));
  const clampedY = Math.max(0, Math.min(imgY, scaledH));

  let displayW, displayH, offsetX, offsetY;
  if (strategy === 'fullscreen') {
    // Full screen: map to entire display
    displayW = FULLSCREEN.width;
    displayH = FULLSCREEN.height;
    offsetX = 0;
    offsetY = 0;
  } else {
    // Crop: map to crop region
    displayW = CROP_META.displayRegionW;
    displayH = CROP_META.displayRegionH;
    offsetX = CROP_META.displayOffsetX;
    offsetY = CROP_META.displayOffsetY;
  }

  const screenX = Math.round(clampedX * (displayW / scaledW) + offsetX);
  const screenY = Math.round(clampedY * (displayH / scaledH) + offsetY);

  console.log(`6. Mapped to screen: (${screenX}, ${screenY})`);
  console.log(`   Expected:         (${EXPECTED_SCREEN.x}, ${EXPECTED_SCREEN.y})`);
  const dx = screenX - EXPECTED_SCREEN.x;
  const dy = screenY - EXPECTED_SCREEN.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  console.log(`   Error: dx=${dx}, dy=${dy}, distance=${dist.toFixed(1)}px\n`);

  // 7. Draw results on crop image
  // AI point position in crop image pixels (before downscale)
  const cropPxX = Math.round(clampedX * (CROP_META.width / scaledW));
  const cropPxY = Math.round(clampedY * (CROP_META.height / scaledH));

  // Expected position in crop image pixels
  const expectedCropX = EXPECTED_SCREEN.x - CROP_META.displayOffsetX;
  const expectedCropY = EXPECTED_SCREEN.y - CROP_META.displayOffsetY;

  const cropImg = sharp(cropBuffer);
  const { width: cw, height: ch } = await cropImg.metadata();

  // Create SVG overlay with markers
  const svg = `<svg width="${cw}" height="${ch}">
    <!-- AI's point (red) -->
    <circle cx="${cropPxX}" cy="${cropPxY}" r="20" fill="none" stroke="red" stroke-width="3"/>
    <line x1="${cropPxX - 25}" y1="${cropPxY}" x2="${cropPxX + 25}" y2="${cropPxY}" stroke="red" stroke-width="2"/>
    <line x1="${cropPxX}" y1="${cropPxY - 25}" x2="${cropPxX}" y2="${cropPxY + 25}" stroke="red" stroke-width="2"/>
    <text x="${cropPxX + 25}" y="${cropPxY - 10}" fill="red" font-size="16" font-weight="bold">AI (${screenX},${screenY})</text>
    <!-- Expected point (green) -->
    <circle cx="${expectedCropX}" cy="${expectedCropY}" r="20" fill="none" stroke="lime" stroke-width="3"/>
    <line x1="${expectedCropX - 25}" y1="${expectedCropY}" x2="${expectedCropX + 25}" y2="${expectedCropY}" stroke="lime" stroke-width="2"/>
    <line x1="${expectedCropX}" y1="${expectedCropY - 25}" x2="${expectedCropX}" y2="${expectedCropY + 25}" stroke="lime" stroke-width="2"/>
    <text x="${expectedCropX + 25}" y="${expectedCropY + 20}" fill="lime" font-size="16" font-weight="bold">Expected (${EXPECTED_SCREEN.x},${EXPECTED_SCREEN.y})</text>
    <!-- Error label -->
    <text x="10" y="30" fill="white" font-size="18" font-weight="bold">Error: ${dist.toFixed(0)}px (dx=${dx}, dy=${dy})</text>
  </svg>`;

  await sharp(cropBuffer)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 90 })
    .toFile(path.join(DEBUG_DIR, 'test-result-crop.jpg'));
  console.log('7. Saved test-result-crop.jpg (red=AI, green=expected)');

  // 8. Draw on fullscreen image too
  const fullPath = path.join(DEBUG_DIR, 'test-fullscreen.jpg');
  if (fs.existsSync(fullPath)) {
    const fullBuffer = fs.readFileSync(fullPath);
    const svgFull = `<svg width="${FULLSCREEN.width}" height="${FULLSCREEN.height}">
      <circle cx="${screenX}" cy="${screenY}" r="25" fill="none" stroke="red" stroke-width="3"/>
      <line x1="${screenX - 30}" y1="${screenY}" x2="${screenX + 30}" y2="${screenY}" stroke="red" stroke-width="2"/>
      <line x1="${screenX}" y1="${screenY - 30}" x2="${screenX}" y2="${screenY + 30}" stroke="red" stroke-width="2"/>
      <text x="${screenX + 30}" y="${screenY - 15}" fill="red" font-size="20" font-weight="bold">AI</text>
      <circle cx="${EXPECTED_SCREEN.x}" cy="${EXPECTED_SCREEN.y}" r="25" fill="none" stroke="lime" stroke-width="3"/>
      <line x1="${EXPECTED_SCREEN.x - 30}" y1="${EXPECTED_SCREEN.y}" x2="${EXPECTED_SCREEN.x + 30}" y2="${EXPECTED_SCREEN.y}" stroke="lime" stroke-width="2"/>
      <line x1="${EXPECTED_SCREEN.x}" y1="${EXPECTED_SCREEN.y - 30}" x2="${EXPECTED_SCREEN.x}" y2="${EXPECTED_SCREEN.y + 30}" stroke="lime" stroke-width="2"/>
      <text x="${EXPECTED_SCREEN.x + 30}" y="${EXPECTED_SCREEN.y + 25}" fill="lime" font-size="20" font-weight="bold">Expected</text>
      <text x="20" y="40" fill="white" font-size="24" font-weight="bold">Error: ${dist.toFixed(0)}px</text>
    </svg>`;

    await sharp(fullBuffer)
      .composite([{ input: Buffer.from(svgFull), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toFile(path.join(DEBUG_DIR, 'test-result-fullscreen.jpg'));
    console.log('8. Saved test-result-fullscreen.jpg');
  }

  console.log('\n=== Done ===');
  console.log(`Check: ${DEBUG_DIR}`);
}

main().catch(console.error);
