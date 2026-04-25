const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

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

// VSCode 日志文件列表缓存 - 避免每次都 find 拖慢速度
let cachedVSCodeLogFiles = null;
let lastVSCodeLogCacheRefresh = 0;
const VSCODE_LOG_CACHE_TTL = 30 * 1000; // 30 秒刷新一次缓存（缓存的只是文件列表，不是日志内容）

// List of AI tools to monitor - process name patterns
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

/**
 * 通过 VSCode Claude 扩展日志检测是否有活跃会话
 * 日志中直接包含 "state":"running" / "state":"idle"，这是最准确的
 */
function checkVSCodeLogActivity() {
  const logBasePath = require('os').homedir() + '/Library/Application Support/Code/logs';

  // 如果日志目录不存在，返回无活动
  if (!fs.existsSync(logBasePath)) {
    return { hasActiveSession: false, lastStateChange: 0 };
  }

  try {
    const now = Date.now();
    let logFiles;

    // 使用缓存避免每次都执行 find（缓存 TTL 30 秒）
    if (cachedVSCodeLogFiles && (now - lastVSCodeLogCacheRefresh) < VSCODE_LOG_CACHE_TTL) {
      logFiles = cachedVSCodeLogFiles;
    } else {
      // 查找所有 Claude 日志文件，按修改时间排序，取最新的 20 个
      // VSCode 每个窗口每个会话都有独立日志，需要检查所有最近打开的窗口
      const findCmd = `find "${logBasePath}" -name "Claude VSCode.log" -type f -print0 | xargs -0 ls -t | head -20`;
      const result = require('child_process').execSync(findCmd, { encoding: 'utf8', timeout: 1000 });
      logFiles = result.trim().split('\n').filter(l => l.length > 0);
      cachedVSCodeLogFiles = logFiles;
      lastVSCodeLogCacheRefresh = now;
    }

    if (logFiles.length === 0) {
      return { hasActiveSession: false, lastStateChange: 0 };
    }

    // 检查所有最新日志文件，找全局最新的状态更新
    let lastStateIsRunning = false;
    let lastStateChangeTime = 0;
    let lastActivityTime = 0; // 独立追踪最后一次活跃操作的时间（不被 idle 状态覆盖）

    // 也检查文件修改时间：如果日志最近 2 分钟被修改过且没找到明确的 idle，也算作可能活跃
    let latestFileMtime = 0;

    for (const logFile of logFiles.slice(0, 10)) {
      if (!fs.existsSync(logFile)) continue;

      const stats = fs.statSync(logFile);
      const fileMtime = stats.mtime.getTime();
      if (fileMtime > latestFileMtime) {
        latestFileMtime = fileMtime;
      }

      // 读取文件最后 16KB 足够找到最近的状态更新
      const size = stats.size;
      const toRead = Math.min(16 * 1024, size);
      const buffer = Buffer.alloc(toRead);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buffer, 0, toRead, size - toRead);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n');

      // 从后往前找最近的状态更新 - 注意：不要 break！
      // 因为 update_session_state 之后可能还有 thought/tool_use 等活跃操作
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('update_session_state')) {
          try {
            // 提取状态
            // running: 正在运行 → 活跃
            // idle / waiting_input: 空闲/等待用户输入 → 不活跃
            const runningMatch = line.match(/"state"\s*:\s*"running"/);
            const idleMatch = line.match(/"state"\s*:\s*"idle"/);
            const waitingInputMatch = line.match(/"state"\s*:\s*"waiting_input"/);

            if (runningMatch || idleMatch || waitingInputMatch) {
              // 提取时间戳从行首
              const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
              let currentIsRunning = !!runningMatch;
              // waiting_input 也是不活跃（等待用户操作）
              if (waitingInputMatch) currentIsRunning = false;

              if (timeMatch) {
                const [, year, month, day, hour, min, sec, ms] = timeMatch;
                const timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();
                if (timestamp > lastStateChangeTime) {
                  lastStateChangeTime = timestamp;
                  lastStateIsRunning = currentIsRunning;
                }
              } else if (fileMtime > lastStateChangeTime) {
                lastStateChangeTime = fileMtime;
                lastStateIsRunning = currentIsRunning;
              }
              // 注意：不要 break！继续往前找可能有更近的活跃操作
            }
          } catch (e) {
            // ignore parse errors
          }
        } else if (
          // 活跃操作检测点 - 只要有这些操作，就说明正在运行
          line.includes('Stream started - received first chunk') ||
          line.includes('Starting new request') ||
          line.includes('Creating message') ||
          line.includes('Streaming response') ||
          line.includes('tool_use') ||
          line.includes('"type": "thinking"') ||
          line.includes('Executing tool') ||
          line.includes('Reading file') ||
          line.includes('Writing file') ||
          line.includes('Executing command') ||
          line.includes('Running tool') ||
          line.includes('thinking delta')
        ) {
          // 以上任意一种日志出现都表示正在运行
          const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
          if (timeMatch) {
            const [, year, month, day, hour, min, sec, ms] = timeMatch;
            const timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();
            // 更新独立的活跃时间（不被 idle 状态覆盖）
            if (timestamp > lastActivityTime) {
              lastActivityTime = timestamp;
            }
            if (timestamp > lastStateChangeTime) {
              lastStateChangeTime = timestamp;
              lastStateIsRunning = true;
            }
          } else if (fileMtime > lastActivityTime) {
            lastActivityTime = fileMtime;
          }
        }
      }
    }

    let hasActiveSession = false;

    // 规则：
    // 1. 如果有明确的状态更新：
    if (lastStateChangeTime > 0) {
      // 状态是 running → 直接活跃
      if (lastStateIsRunning) {
        hasActiveSession = (now - lastStateChangeTime) < 5 * 60 * 1000;
      }
      // 状态是 idle，但后面又有新的活跃操作（活跃操作比状态更新还新）→ 活跃
      // 这解决了 update_session_state 先输出 idle，但 Claude 其实还在 thinking 的问题
      else if (lastActivityTime > lastStateChangeTime && (now - lastActivityTime) < 10 * 1000) {
        hasActiveSession = true;
      }
      // 否则就是真的 idle
      else {
        hasActiveSession = false;
      }
    }
    // 2. 如果没找到明确状态更新，但日志最近 2 分钟内被修改过 → 算作活跃（保险起见）
    else if (latestFileMtime > 0) {
      hasActiveSession = (now - latestFileMtime) < 2 * 60 * 1000;
    }

    if (cachedVSCodeLogFiles) {
      console.log(`📝 VSCode Log check: cached=${(now - lastVSCodeLogCacheRefresh)/1000 < VSCODE_LOG_CACHE_TTL/1000}, found ${logFiles.length} logs, lastState=${lastStateIsRunning ? 'RUNNING' : 'IDLE'}, lastChangeAge=${lastStateChangeTime > 0 ? ((now - lastStateChangeTime)/1000).toFixed(1) + 's' : 'none'}, lastActivityAge=${lastActivityTime > 0 ? ((now - lastActivityTime)/1000).toFixed(1) + 's' : 'none'}, latestFileAge=${((now - latestFileMtime)/1000).toFixed(1)}s, active=${hasActiveSession}`);
    } else {
      console.log(`📝 VSCode Log check: cached=no, found ${logFiles.length} logs, lastState=${lastStateIsRunning ? 'RUNNING' : 'IDLE'}, lastChangeAge=${lastStateChangeTime > 0 ? ((now - lastStateChangeTime)/1000).toFixed(1) + 's' : 'none'}, lastActivityAge=${lastActivityTime > 0 ? ((now - lastActivityTime)/1000).toFixed(1) + 's' : 'none'}, latestFileAge=${((now - latestFileMtime)/1000).toFixed(1)}s, active=${hasActiveSession}`);
    }

    return { hasActiveSession, lastStateChangeTime };
  } catch (e) {
    console.error('Error checking VSCode logs:', e);
    return { hasActiveSession: false, lastStateChangeTime: 0 };
  }
}

function checkAIRunning(callback) {
  // 第一步：先检查 VSCode 日志（这是最准确的）
  const logCheck = checkVSCodeLogActivity();

  exec('ps -axo pid,ppid,%cpu,%mem,stat,command', (error, stdout) => {
    if (error) {
      console.error('Error checking processes:', error);
      if (callback) {
        callback({ status: CLAUDE_STATES.IDLE, taskCount: 0 });
      }
      return;
    }

    const processes = parseProcessList(stdout);

    // 检测 VSCode Claude Code 扩展
    const vscodeClaudeProcesses = processes.filter(p => p.isVSCodeClaude);
    let vscodeActiveCount = 0;

    for (const proc of vscodeClaudeProcesses) {
      // 多因素综合判断：
      // 1. 进程状态检测：R = running 正在运行，S = sleeping 睡眠空闲
      //    This is the most reliable indicator from the OS kernel
      const statIsRunning = proc.stat === 'R';

      // 2. 子进程检测：有子进程且子进程本身活跃才算活跃
      // 原理：VSCode Claude 任务运行时会 spawn 子进程，任务完成后子进程退出或变成 idle
      // 需要子进程本身正在运行才判定为活跃
      // 跳过工具类/临时 shell 命令：这些是 Claude 执行完就退出的临时任务，不算持续活跃
      let hasActiveChildren = false;
      for (const child of processes) {
        if (child.ppid === proc.pid) {
          // 跳过工具类命令（ps/grep/eval/shell 这些只是临时命令）
          const cmd = child.commandLower;
          if (cmd.includes('grep') || cmd.includes(' ps ') ||
              cmd.includes('eval') || cmd.includes('source') ||
              cmd.includes('/bin/zsh') || cmd.includes('/bin/bash') || cmd.includes('/bin/sh')) {
            continue;
          }
          // 子进程必须本身活跃：正在运行 或者 CPU 不为零
          if (child.stat === 'R' || child.cpu > 0.1) {
            hasActiveChildren = true;
            break;
          }
        }
      }

      // Only use RELIABLE indicators based on CURRENT state:
      // - Command line arguments are FIXED at process startup - they never change!
      // - Has active non-shell child processes: A task that's executing commands will always have active children
      const isActive = hasActiveChildren;

      if (isActive) {
        vscodeActiveCount++;
        console.log('✓ VSCode Claude active:', proc.pid, `stat=${proc.stat}`, `hasActiveChildren=${hasActiveChildren}`);
      } else {
        console.log('○ VSCode Claude idle:', proc.pid, `stat=${proc.stat}`, `hasActiveChildren=${hasActiveChildren}`);
      }
    }

    // 检测终端 Claude Code
    const terminalClaudeProcesses = processes.filter(p => {
      const cmd = p.commandLower;
      // 匹配终端中的 claude 命令，但排除 VSCode 扩展和应用程序
      return (cmd === 'claude' || cmd.includes('claude ')) &&
             !p.commandLower.includes('.vscode/') &&
             !p.commandLower.includes('/applications/') &&
             !p.commandLower.includes('claude-code');
    });

    let terminalActiveCount = 0;
    for (const proc of terminalClaudeProcesses) {
      // 终端 claude：只看进程是否为 running 状态
      const isActive = proc.stat === 'R';
      if (isActive) {
        terminalActiveCount++;
        console.log('✓ Terminal Claude active:', proc.pid, `stat=${proc.stat}`);
      } else {
        console.log('○ Terminal Claude idle:', proc.pid, `stat=${proc.stat}`);
      }
    }

    // 兜底逻辑：如果日志检测到有活跃会话，但进程检测一个都没找到
    // 以日志为准（日志直接来自 Claude 扩展输出，最准确），算一个活跃任务
    // 这样不会重复计数 - 只在进程检测没找到的时候才兜底
    if (logCheck.hasActiveSession && vscodeActiveCount === 0 && vscodeClaudeProcesses.length > 0) {
      vscodeActiveCount = 1;
      console.log('✓ VSCode log indicates active session but process detection found none, counting 1 active task (log is more reliable)');
    }

    const totalTaskCount = vscodeActiveCount + terminalActiveCount;
    const currentIsRunning = totalTaskCount > 0;

    console.log(`Result: currentIsRunning=${currentIsRunning}, VSCode active=${vscodeActiveCount}, Terminal active=${terminalActiveCount}, Total tasks=${totalTaskCount}`);

    // 防抖：需要连续多次不活跃才切换到 idle，避免波动
    // Keep count consistent with state: if we're still holding active state, keep previous count
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
