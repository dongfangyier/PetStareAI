const { app, BrowserWindow, ipcMain, ipcRenderer } = require('electron');
const path = require('path');
const { exec } = require('child_process');

let mainWindow;
let monitoringInterval = null;

// List of AI tools to monitor - process name patterns
const AI_TOOLS = [
  { id: 'claude', name: 'Claude', patterns: ['Claude', 'claude'] },
  { id: 'chatgpt', name: 'ChatGPT', patterns: ['ChatGPT', 'chatgpt'] },
  { id: 'gemini', name: 'Gemini', patterns: ['Gemini', 'gemini'] },
  { id: 'cursor', name: 'Cursor', patterns: ['Cursor', 'cursor'] },
  { id: 'vscode', name: 'VS Code', patterns: ['Code', 'code'] },
  { id: 'ollama', name: 'Ollama', patterns: ['ollama'] },
  { id: 'lmstudio', name: 'LM Studio', patterns: ['LM Studio', 'LM'] },
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 280,
    height: 360,
    x: 100,
    y: 100,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.setIgnoreMouseEvents(false);

  // Start monitoring when window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    startMonitoring();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopMonitoring();
  });
}

function checkAIRunning(callback) {
  // On macOS, use ps command to list all processes
  exec('ps -ax -o comm=', (error, stdout, stderr) => {
    if (error) {
      console.error('Error checking processes:', error);
      callback([]);
      return;
    }

    const processes = stdout.split('\n').map(p => p.trim()).filter(p => p.length > 0);
    const runningTools = [];

    for (const tool of AI_TOOLS) {
      const isRunning = processes.some(process => {
        return tool.patterns.some(pattern => process.includes(pattern));
      });
      if (isRunning) {
        runningTools.push(tool.id);
      }
    }

    callback(runningTools);
  });
}

function startMonitoring() {
  // Check every 2 seconds
  monitoringInterval = setInterval(() => {
    checkAIRunning((runningTools) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', runningTools);
      }
    });
  }, 2000);

  // Check immediately
  checkAIRunning((runningTools) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('status-update', runningTools);
    }
  });
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers for window movement
ipcMain.on('set-position', (event, x, y) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    const [width, height] = mainWindow.getSize();
    mainWindow.setPosition(Math.round(x), Math.round(y));
  }
});

ipcMain.on('quit', () => {
  app.quit();
});

ipcMain.handle('get-initial-tools', () => {
  return new Promise((resolve) => {
    checkAIRunning(resolve);
  });
});
