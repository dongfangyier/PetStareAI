const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

// ===== 可扩展检测架构 =====
const { detectorManager } = require('./detectors');

let mainWindow;
let tray = null;
let monitoringInterval = null;

// Window sizes for different states
const WINDOW_SIZES = {
  COMPACT: { width: 80, height: 125 },   // Only cat, no extra transparent area (+5px height)
  FULL: { width: 180, height: 180 }      // Full size for minigame
};

// 防抖：记录上次检测结果，连续不活跃才切换到 idle
let lastReportedTotalTasks = 0;
let lastReportedIsRunning = false;
const REQUIRES_INACTIVE_COUNT = 2; // 需要连续 2 次检测不活跃才切换 idle (4 seconds) - 减少延迟更响应
let consecutiveInactiveCount = 0;

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
    // format: PID PPID %CPU %MEM STAT COMMAND
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const pid = parseInt(parts[0], 10);
    const ppid = parseInt(parts[1], 10);
    const cpu = parseFloat(parts[2]);
    const mem = parseFloat(parts[3]);
    const stat = parts[4]; // process state: R=running, S=sleeping
    const command = parts.slice(5).join(' ');

    if (isNaN(pid) || isNaN(ppid) || isNaN(cpu) || isNaN(mem)) continue;

    const commandLower = command.toLowerCase();
    processes.push({
      pid,
      ppid,
      cpu,
      mem,
      stat: stat.charAt(0), // first char = state
      command,
      commandLower,
      // VSCode Claude detection - flexible matching for various install locations
      isVSCodeClaude: (
        // Standard local installation (with or without version number)
        (commandLower.includes('.vscode/extensions/anthropic.claude-code') ||
         commandLower.match(/\.vscode\/extensions\/anthropic\.claude-code-[\d.]+/)) &&
        commandLower.includes('native-binary/claude')
      ) || (
        // Remote SSH/WSL development
        (commandLower.includes('.vscode-server/') ||
         commandLower.includes('.vscode-remote/')) &&
        commandLower.includes('claude') &&
        commandLower.includes('extensions')
      ) || (
        // Fallback: any VSCode extension Claude with signature
        commandLower.includes('claude') &&
        commandLower.includes('anthropic') &&
        commandLower.includes('extension')
      ),
      hasResume: command.includes('--resume'),
      // Only task-specific keywords - --permission-mode removed because it's always a launch argument
      hasExecKeywords: commandLower.includes('run') ||
                       commandLower.includes('prompt') ||
                       commandLower.includes('continue') ||
                       commandLower.includes('accept') ||
                       commandLower.includes('/loop') ||
                       command.includes('--resume') ||
                       command.includes('--execute'),
    });
  }

  return processes;
}

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

    // 使用可扩展检测架构：运行所有已加载的检测器
    const detectionResult = await detectorManager.detectAll({ processes });

    // 找到 VSCode 检测结果用于兜底逻辑
    const vscodeResult = detectionResult.results.find(r => r.id === 'claude-vscode');
    let vscodeActiveCount = vscodeResult ? vscodeResult.activeCount : 0;

    // 兜底逻辑：如果日志检测到有活跃会话，但进程检测一个都没找到
    // 以日志为准（日志直接来自 Claude 扩展输出，最准确），算一个活跃任务
    if (vscodeResult && vscodeResult.logActive &&
        vscodeActiveCount === 0 && vscodeResult.processCount > 0) {
      vscodeActiveCount = 1;
      console.log('✓ VSCode log indicates active session but process detection found none, counting 1 active task (log is more reliable)');
    }

    // 重新计算总数（包括 OpenCode、Qoder IDE、Qoder CLI）
    const terminalResult = detectionResult.results.find(r => r.id === 'claude-terminal');
    const terminalActiveCount = terminalResult ? terminalResult.activeCount : 0;
    const opencodeResult = detectionResult.results.find(r => r.id === 'opencode');
    const opencodeActiveCount = opencodeResult ? opencodeResult.activeCount : 0;
    const qoderResult = detectionResult.results.find(r => r.id === 'qoder');
    const qoderActiveCount = qoderResult ? qoderResult.activeCount : 0;
    const qoderCliResult = detectionResult.results.find(r => r.id === 'qoder-cli');
    const qoderCliActiveCount = qoderCliResult ? qoderCliResult.activeCount : 0;
    const totalTaskCount = vscodeActiveCount + terminalActiveCount + opencodeActiveCount + qoderActiveCount + qoderCliActiveCount;
    const currentIsRunning = totalTaskCount > 0;

    // 输出详细检测结果
    for (const result of detectionResult.results) {
      let displayCount = result.activeCount;
      if (result.id === 'claude-vscode') displayCount = vscodeActiveCount;
      if (result.id === 'opencode') displayCount = opencodeActiveCount;
      if (result.id === 'qoder') displayCount = qoderActiveCount;
      if (result.id === 'qoder-cli') displayCount = qoderCliActiveCount;
      if (displayCount > 0) {
        console.log(`✓ ${result.name} active: ${displayCount} instances`);
      } else {
        console.log(`○ ${result.name}: idle`);
      }
    }
    console.log(`Total active: ${totalTaskCount}, isRunning: ${currentIsRunning}`);

    // 防抖：需要连续多次不活跃才切换到 idle，避免波动
    let finalIsRunning = lastReportedIsRunning;
    let finalTotalTasks = lastReportedTotalTasks;

    if (currentIsRunning) {
      // 当前活跃，直接切活跃，重置计数器
      consecutiveInactiveCount = 0;
      finalIsRunning = true;
      finalTotalTasks = totalTaskCount;
    } else {
      // 当前不活跃，计数
      consecutiveInactiveCount++;
      if (consecutiveInactiveCount >= REQUIRES_INACTIVE_COUNT) {
        // 连续多次不活跃，切换到 idle
        finalIsRunning = false;
        finalTotalTasks = 0;
      } else {
        // 保持上次状态和上次计数 - keep consistency
        finalIsRunning = lastReportedIsRunning;
        finalTotalTasks = lastReportedTotalTasks;
      }
    }

    const finalStatus = finalIsRunning ? CLAUDE_STATES.RUNNING : CLAUDE_STATES.IDLE;

    // 只有状态改变才发送通知给窗口，避免闪烁
    if (finalIsRunning !== lastReportedIsRunning || finalTotalTasks !== lastReportedTotalTasks) {
      console.log(`State changed: last running=${lastReportedIsRunning}, new running=${finalIsRunning}, total=${finalTotalTasks}`);
      lastReportedIsRunning = finalIsRunning;
      lastReportedTotalTasks = finalTotalTasks;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('claude-status', {
          status: finalStatus,
          taskCount: finalTotalTasks
        });
      }
    }

    // 如果是 IPC 请求，始终返回结果
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
