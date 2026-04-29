const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { detectAll, detectors } = require('./detectors');

let mainWindow;
let tray = null;
let monitoringInterval = null;

// Window sizes for different states
const WINDOW_SIZES = {
  COMPACT: { width: 80, height: 125 },   // Only cat, no extra transparent area (+5px height)
  FULL: { width: 180, height: 180 }      // Full size for minigame
};

// Debounce: require consecutive inactive checks before switching to idle
let lastReportedTotalTasks = 0;
let lastReportedIsRunning = false;
const REQUIRES_INACTIVE_COUNT = 2; // Require 2 consecutive inactive checks to switch to idle
let consecutiveInactiveCount = 0;

// List of AI tools to monitor - process name patterns (for reference only)
const AI_TOOLS = [
  { id: 'claude', name: 'Claude', patterns: ['Claude', 'claude', 'Claude Desktop'] },
  { id: 'claude-code', name: 'Claude Code', patterns: ['claude-code', 'Claude Code', 'claude'] },
  { id: 'opencode', name: 'OpenCode', patterns: ['OpenCode', 'opencode', 'open code'] },
  { id: 'chatgpt', name: 'ChatGPT', patterns: ['ChatGPT', 'chatgpt', 'ChatGPT Desktop'] },
  { id: 'gemini', name: 'Gemini', patterns: ['Gemini', 'gemini', 'Google Gemini'] },
  { id: 'cursor', name: 'Cursor', patterns: ['Cursor', 'cursor'] },
  { id: 'vscode', name: 'VS Code', patterns: ['Code', 'code', 'VSCode', 'Visual Studio Code'] },
  { id: 'ollama', name: 'Ollama', patterns: ['ollama', 'Ollama'] },
  { id: 'lmstudio', name: 'LM Studio', patterns: ['LM Studio', 'LM', 'LMStudio'] },
];

function createWindow() {
  // Get primary display to ensure window is visible
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.bounds;
  // Start with compact size (only cat, no extra transparent area)
  const { width: windowWidth, height: windowHeight } = WINDOW_SIZES.COMPACT;

  // CENTER the window on screen - GUARANTEED to be visible
  const centerX = Math.floor((screenWidth - windowWidth) / 2);
  const centerY = Math.floor((screenHeight - windowHeight) / 3);
  console.log(`Screen size: ${screenWidth}x${screenHeight}`);
  console.log(`Window CENTER position: ${centerX}, ${centerY} (size: ${windowWidth}x${windowHeight})`);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: centerX,
    y: centerY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: true,
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  // In packaged app, app.getAppPath() gives the correct root
  // When packaged, everything is under app.asar
  const getIndexPath = () => {
    if (app.isPackaged) {
      // Packaged - dist is at root of app.asar
      return path.join(app.getAppPath(), 'dist', 'index.html');
    } else {
      // Development - __dirname/../dist
      return path.join(__dirname, '..', 'dist', 'index.html');
    }
  };

  const indexPath = getIndexPath();
  console.log('app.isPackaged =', app.isPackaged);
  console.log('Loading index.html from:', indexPath);
  console.log('File exists:', fs.existsSync(indexPath));

  if (!fs.existsSync(indexPath)) {
    // Try fallbacks
    const possiblePaths = [
      indexPath,
      path.join(process.resourcesPath, 'dist', 'index.html'),
      path.join(app.getAppPath(), '..', 'dist', 'index.html'),
    ];

    let loadedPath = null;
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          console.log('FOUND index.html at fallback:', p);
          mainWindow.loadFile(p);
          loadedPath = p;
          break;
        }
      } catch (e) {
        console.log('Error checking', p, e);
      }
    }

    if (!loadedPath) {
      console.error('Failed to find index.html in any of:', possiblePaths);
      dialog.showErrorBox(
        'PetStareAI - Cannot find index.html',
        `Searched in:\n${possiblePaths.join('\n')}\n\nPlease check the installation.`
      );
    }
  } else {
    mainWindow.loadFile(indexPath);
  }

  // Handle load failure
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load page:', errorCode, errorDescription, validatedURL);
    dialog.showErrorBox(
      'PetStareAI - Loading Error',
      `Failed to load the application page.\nError ${errorCode}: ${errorDescription}\n\nTried to load:\n${indexPath}`
    );
  });

  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setAlwaysOnTop(true, 'floating');

  // Start monitoring when window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded, starting monitoring');
    // Explicitly show and focus after content is loaded
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true, 'floating');
    console.log('Window shown, dimensions:', mainWindow.getBounds());
    startMonitoring();
  });

  // Fallback - force show after 1 second if something went wrong
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Fallback: Force showing window after timeout');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 1000);

  mainWindow.on('closed', () => {
    console.log('Window closed');
    mainWindow = null;
    stopMonitoring();
  });
}

const CLAUDE_STATES = {
  IDLE: 'idle',
  RUNNING: 'busy',
  SUCCESS: 'success',
  ERROR: 'error',
  SLEEPING: 'sleeping',
};

/**
 * 解析 ps 命令输出，提取进程信息
 */
function parseProcessList(stdout) {
  const lines = stdout.split('\n').map(p => p.trim()).filter(p => p.length > 0);
  const processes = [];

  for (const line of lines) {
    // ps -axo pid,ppid,%cpu,%mem,stat,command
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    const cpu = parseFloat(parts[2]);
    const mem = parseFloat(parts[3]);
    const stat = parts[4]; // R=running, S=sleeping
    const command = parts.slice(5).join(' ');

    if (isNaN(pid) || isNaN(ppid) || isNaN(cpu) || isNaN(mem)) continue;

    processes.push({
      pid,
      ppid,
      cpu,
      mem,
      stat: stat.charAt(0),
      command,
      commandLower: command.toLowerCase(),
    });
  }

  return processes;
}

/**
 * Run all detectors and determine overall state
 * Uses the pluggable detector system - add new tools by creating detector files
 */
async function checkAIRunning(callback) {
  exec('ps -axo pid,ppid,%cpu,%mem,stat,command', async (error, stdout) => {
    if (error) {
      console.error('Error checking processes:', error);
      if (callback) {
        callback({ status: CLAUDE_STATES.IDLE, taskCount: 0 });
      }
      return;
    }

    const processes = parseProcessList(stdout);

    // Run all loaded detectors (plug-in architecture)
    const detection = await detectAll(processes);
    const totalTaskCount = detection.totalActiveCount;
    const currentIsRunning = totalTaskCount > 0;

    // Debug output for each detector
    for (const d of detection.results) {
      console.log(`🔍 ${d.name}: active=${d.activeCount}${d.message ? ` (${d.message})` : ''}`);
    }
    console.log(`📊 Total: running=${currentIsRunning}, tasks=${totalTaskCount}, detectors=${detection.results.length}`);

    // Debounce: require consecutive inactive checks before switching to idle
    let finalIsRunning = lastReportedIsRunning;
    let finalTotalTasks = lastReportedTotalTasks;

    if (currentIsRunning) {
      consecutiveInactiveCount = 0;
      finalIsRunning = true;
      finalTotalTasks = totalTaskCount;
    } else {
      consecutiveInactiveCount++;
      if (consecutiveInactiveCount >= REQUIRES_INACTIVE_COUNT) {
        finalIsRunning = false;
        finalTotalTasks = 0;
      } else {
        finalIsRunning = lastReportedIsRunning;
        finalTotalTasks = lastReportedTotalTasks;
      }
    }

    const finalStatus = finalIsRunning ? CLAUDE_STATES.RUNNING : CLAUDE_STATES.IDLE;

    // Send status update only on change
    if (finalIsRunning !== lastReportedIsRunning || finalTotalTasks !== lastReportedTotalTasks) {
      console.log(`⚡ State changed: ${lastReportedIsRunning ? 'running' : 'idle'} → ${finalIsRunning ? 'running' : 'idle'}, tasks=${finalTotalTasks}`);
      lastReportedIsRunning = finalIsRunning;
      lastReportedTotalTasks = finalTotalTasks;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-status', {
          status: finalStatus,
          taskCount: finalTotalTasks
        });
      }
    }

    if (callback) {
      callback({
        status: finalStatus,
        taskCount: totalTaskCount
      });
    }
  });
}

function startMonitoring() {
  // Check every 1 second for faster response when task completes
  monitoringInterval = setInterval(() => {
    checkAIRunning();
  }, 1000);

  // Check immediately
  checkAIRunning();
}

function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

function createTray() {
  // Use a pre-downloaded valid PNG icon from file - guaranteed to work
  // User can replace this file easily with their own icon
  const iconPath = path.join(__dirname, '..', 'assets', 'icon-16.png');
  console.log('Loading tray icon from file:', iconPath);
  console.log('File exists:', fs.existsSync(iconPath));

  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true); // Adapts automatically to light/dark mode on macOS

  console.log('Creating tray with icon from file');
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Quit',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('PetStareAI - Monitoring AI tools');
  tray.setContextMenu(contextMenu);

  // Click on tray icon toggles window
  tray.on('click', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  console.log('Tray created successfully');
}

app.whenReady().then(() => {
  // No tray icon - hide dock icon since app stays out of dock
  app.dock.hide();

  createWindow();
  // createTray(); - removed tray icon as requested

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Without tray, quit when all windows closed
app.on('window-all-closed', () => {
  app.quit();
});

// Handle context menu from renderer (right click on cat)
ipcMain.on('show-context-menu', () => {
  if (!mainWindow) return;

  const menu = Menu.buildFromTemplate([
    {
      label: 'Quit PetStareAI',
      click: () => {
        app.quit();
      }
    }
  ]);

  menu.popup({ window: mainWindow });
});

// IPC handlers for window movement
ipcMain.on('set-position', (event, x, y) => {
  if (mainWindow) {
    const [currentX, currentY] = mainWindow.getPosition();
    const [width, height] = mainWindow.getSize();
    mainWindow.setPosition(Math.round(x), Math.round(y));
  }
});

// IPC handler for dynamic window resizing based on game state
ipcMain.on('set-window-size', (event, sizeMode) => {
  if (!mainWindow) return;

  const size = WINDOW_SIZES[sizeMode.toUpperCase()] || WINDOW_SIZES.COMPACT;
  const [currentWidth, currentHeight] = mainWindow.getSize();

  // Only resize if actually changed to avoid unnecessary redraws
  if (currentWidth !== size.width || currentHeight !== size.height) {
    // Keep window centered when changing size
    const [x, y] = mainWindow.getPosition();
    const offsetX = Math.floor((currentWidth - size.width) / 2);
    const offsetY = Math.floor((currentHeight - size.height) / 2);

    mainWindow.setSize(size.width, size.height, true);
    mainWindow.setPosition(x + offsetX, y + offsetY);
  }
});

ipcMain.on('quit', () => {
  app.quit();
});

ipcMain.handle('get-claude-status', () => {
  return new Promise((resolve) => {
    checkAIRunning(resolve);
  });
});
