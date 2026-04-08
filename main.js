const path = require('path');
const fs = require('fs');

// Load .env from multiple possible locations (dev vs packaged)
let envLoaded = false;
const os = require('os');
const envPaths = [
  path.join(os.homedir(), '.oraai', '.env'),       // ~/.oraai/.env (recommended for users)
  path.join(__dirname, '.env'),                      // dev mode
  path.join(process.resourcesPath || '', '.env'),    // packaged (extra-resource)
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', 'Resources', '.env'),
];
for (const p of envPaths) {
  try {
    if (fs.existsSync(p)) {
      require('dotenv').config({ path: p });
      console.log('OraAI: Loaded .env from', p);
      envLoaded = true;
      break;
    }
  } catch {}
}
if (!envLoaded) console.error('OraAI: .env NOT FOUND');
console.log('OraAI: OPENROUTER key present:', !!process.env.OPENROUTER_API_KEY);
console.log('OraAI: ELEVENLABS key present:', !!process.env.ELEVENLABS_API_KEY);

const { app, BrowserWindow, globalShortcut, ipcMain, screen, desktopCapturer, session, Tray, Menu, nativeImage, systemPreferences, shell } = require('electron');

let overlayWindow = null;
let tray = null;
let mouseInterval = null;
let isListening = false;
let showTranscript = true;

// ============================================================
//  APP STARTUP
// ============================================================

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

app.whenReady().then(async () => {
  if (isMac) try { app.dock?.hide(); } catch {}

  // Request microphone (macOS only — Windows grants via system prompt)
  if (isMac) {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus === 'not-determined') {
        await systemPreferences.askForMediaAccess('microphone');
      }
      console.log('OraAI: Mic:', systemPreferences.getMediaAccessStatus('microphone'));
    } catch {}
  }

  createOverlayWindow();

  // Set up system screen picker for getDisplayMedia
  setupScreenCapture();

  try { createTray(); } catch (e) { console.error('Tray error:', e); }
  registerHotkey();
  startMouseTracking();

  console.log('OraAI: App ready — press Option+Space to talk');
});

// ============================================================
//  SCREEN CAPTURE via system picker (bypasses Screen Recording checkbox)
// ============================================================

function setupScreenCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0] });
      }
    });
  }, { useSystemPicker: true });

  console.log('OraAI: Screen capture via system picker enabled');
}

// ============================================================
//  OVERLAY WINDOW
// ============================================================

function createOverlayWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  overlayWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Forward ALL renderer console output to terminal
  overlayWindow.webContents.on('console-message', (_, level, msg) => {
    console.log(`[renderer] ${msg}`);
  });

  overlayWindow.setIgnoreMouseEvents(true);
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

// ============================================================
//  TRAY
// ============================================================

function createTray() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2, r = 6;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (py * size + px) * 4;
      if (dist <= r) {
        const alpha = dist > r - 1 ? Math.round((r - dist) * 255) : 255;
        buf[idx] = 168; buf[idx + 1] = 85; buf[idx + 2] = 247; buf[idx + 3] = alpha;
      }
    }
  }
  const icon = nativeImage.createFromBuffer(buf, { width: size, height: size, scaleFactor: 1.0 });
  tray = new Tray(icon);
  tray.setToolTip('OraAI');

  function rebuildTrayMenu() {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'OraAI v1.1', enabled: false },
      { type: 'separator' },
      { label: 'Option+Space to talk', enabled: false },
      { type: 'separator' },
      {
        label: 'Show Transcript',
        type: 'checkbox',
        checked: showTranscript,
        click: (item) => {
          showTranscript = item.checked;
          overlayWindow?.webContents.send('setting-changed', { showTranscript });
        },
      },
      { type: 'separator' },
      { label: 'Quit OraAI', click: () => app.quit() },
    ]));
  }

  rebuildTrayMenu();
}

// ============================================================
//  HOTKEY: Option+Space
// ============================================================

function registerHotkey() {
  try {
    const ok = globalShortcut.register('Alt+Space', () => {
      if (!isListening) {
        isListening = true;
        overlayWindow?.webContents.send('hotkey', 'start');
      } else {
        isListening = false;
        overlayWindow?.webContents.send('hotkey', 'stop');
      }
    });
    console.log('OraAI: Hotkey', ok ? 'registered' : 'FAILED');

    // F2 = debug: log mouse position + window bounds
    globalShortcut.register('F2', () => {
      const point = screen.getCursorScreenPoint();
      const wb = overlayWindow ? overlayWindow.getBounds() : {};
      const cb = overlayWindow ? overlayWindow.getContentBounds() : {};
      console.log(`DEBUG MOUSE: screen(${point.x}, ${point.y}) winBounds=${JSON.stringify(wb)} contentBounds=${JSON.stringify(cb)}`);
      overlayWindow?.webContents.send('debug-mouse', point);
    });
  } catch (e) { console.error('OraAI: Hotkey error:', e.message); }
}

// ============================================================
//  MOUSE TRACKING
// ============================================================

function startMouseTracking() {
  mouseInterval = setInterval(() => {
    try {
      const point = screen.getCursorScreenPoint();
      overlayWindow?.webContents.send('mouse-move', point);
    } catch {}
  }, 16);
}

// ============================================================
//  IPC: get screen info for coordinate mapping
// ============================================================

ipcMain.handle('get-screen-info', () => {
  const d = screen.getPrimaryDisplay();
  const bounds = overlayWindow ? overlayWindow.getBounds() : { x: 0, y: 0 };
  return {
    width: d.size.width,
    height: d.size.height,
    scaleFactor: d.scaleFactor,
    windowY: bounds.y, // Where the window starts on screen (menu bar height)
  };
});

// ============================================================
//  ACCESSIBILITY: get UI elements with pixel-perfect positions
// ============================================================

// Find the PID of the frontmost non-OraAI app (macOS only)
function getFrontAppPid() {
  if (!isMac) return null; // Windows: no AX helper, use vision fallback
  const { execSync } = require('child_process');
  const skipNames = ['electron', 'oraai'];
  try {
    // Fast: get all visible app PIDs and names via ps
    const lines = execSync(
      "osascript -e 'tell application \"System Events\" to get {unix id, name} of every process whose visible is true'",
      { timeout: 2000 }
    ).toString().trim();

    // Parse: "12345, 67890, ..., Firefox, Safari, ..."
    // AppleScript returns two lists: {pid1, pid2, ...}, {name1, name2, ...}
    // But actually it returns them interleaved or as two comma-separated groups
    // Let's use a simpler approach
  } catch {}

  try {
    // Simpler: just get frontmost app PID
    const pid = execSync(
      "osascript -e 'tell application \"System Events\" to unix id of first process whose frontmost is true'",
      { timeout: 1500 }
    ).toString().trim();
    const name = execSync(
      "osascript -e 'tell application \"System Events\" to name of first process whose frontmost is true'",
      { timeout: 1500 }
    ).toString().trim();

    console.log(`OraAI: Frontmost app: "${name}" pid=${pid}`);

    if (skipNames.some(s => name.toLowerCase().includes(s))) {
      console.log('OraAI: Frontmost is OraAI/Electron, skipping');
      return null;
    }
    return parseInt(pid, 10);
  } catch (e) {
    console.error('OraAI: getFrontAppPid failed:', e.message);
    return null;
  }
}

ipcMain.handle('get-ax-elements', async () => {
  const pid = getFrontAppPid();
  console.log('OraAI: Target app PID:', pid);

  const helperPaths = [
    path.join(__dirname, 'helpers', 'ax-elements'),
    path.join(process.resourcesPath || '', 'ax-elements'),
    path.join(process.resourcesPath || '', 'helpers', 'ax-elements'),
    path.join(__dirname, '..', 'Resources', 'ax-elements'),
    path.join(__dirname, '..', 'helpers', 'ax-elements'),
  ];

  for (const hp of helperPaths) {
    if (fs.existsSync(hp)) {
      const args = pid ? [String(pid)] : [];
      return new Promise((resolve) => {
        const { execFile } = require('child_process');
        execFile(hp, args, { timeout: 5000 }, (err, stdout) => {
          if (err) {
            console.error('OraAI: ax-elements failed:', err.message);
            resolve([]);
            return;
          }
          try {
            const elements = JSON.parse(stdout);
            console.log(`OraAI: Got ${elements.length} UI elements from Accessibility API`);
            resolve(elements);
          } catch (e) {
            console.error('OraAI: ax-elements parse error:', e.message);
            resolve([]);
          }
        });
      });
    }
  }

  console.warn('OraAI: ax-elements helper not found');
  return [];
});

// ============================================================
//  DEBUG: save screenshot to disk
// ============================================================

ipcMain.handle('save-debug-screenshot', (_, base64) => {
  const p = '/tmp/oraai-debug.jpg';
  fs.writeFileSync(p, Buffer.from(base64, 'base64'));
  console.log('OraAI: Debug screenshot saved to', p);
  return p;
});

// ============================================================
//  CONFIG
// ============================================================

ipcMain.handle('get-config', () => ({
  openrouterKey: process.env.OPENROUTER_API_KEY,
  elevenlabsKey: process.env.ELEVENLABS_API_KEY,
}));

// ============================================================
//  CLEANUP
// ============================================================

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (mouseInterval) clearInterval(mouseInterval);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => console.error('OraAI uncaught:', err));
process.on('unhandledRejection', (err) => console.error('OraAI rejection:', err));
