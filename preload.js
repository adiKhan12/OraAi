const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oraAPI', {
  onMouseMove: (callback) => ipcRenderer.on('mouse-move', (_, point) => callback(point)),
  onHotkey: (callback) => ipcRenderer.on('hotkey', (_, action) => callback(action)),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),
  getAXElements: () => ipcRenderer.invoke('get-ax-elements'),
  onDebugMouse: (callback) => ipcRenderer.on('debug-mouse', (_, point) => callback(point)),
  saveDebugScreenshot: (base64) => ipcRenderer.invoke('save-debug-screenshot', base64),
});
