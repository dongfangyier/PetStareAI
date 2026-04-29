/**
 * Claude VSCode 插件检测器
 * 检测方式: 日志分析 + 进程子进程活动
 */

const fs = require('fs');

// 日志缓存 - 避免每次都执行 find 命令
let cachedLogFiles = null;
let lastLogCacheRefresh = 0;
const LOG_CACHE_TTL = 30 * 1000;

const LOG_BASE_PATH = require('os').homedir() + '/Library/Application Support/Code/logs';

/**
 * 检查 VSCode Claude 日志中的活跃状态
 */
function checkLogActivity() {
  if (!fs.existsSync(LOG_BASE_PATH)) {
    return { hasActiveSession: false, lastStateChange: 0 };
  }

  try {
    const now = Date.now();
    let logFiles;

    // 使用缓存或重新获取日志文件列表
    if (cachedLogFiles && (now - lastLogCacheRefresh) < LOG_CACHE_TTL) {
      logFiles = cachedLogFiles;
    } else {
      const findCmd = `find "${LOG_BASE_PATH}" -name "Claude VSCode.log" -type f -print0 | xargs -0 ls -t | head -20`;
      const result = require('child_process').execSync(findCmd, { encoding: 'utf8', timeout: 1000 });
      logFiles = result.trim().split('\n').filter(l => l.length > 0);
      cachedLogFiles = logFiles;
      lastLogCacheRefresh = now;
    }

    if (logFiles.length === 0) {
      return { hasActiveSession: false, lastStateChange: 0 };
    }

    let lastStateIsRunning = false;
    let lastStateChangeTime = 0;
    let lastActivityTime = 0;
    let latestFileMtime = 0;

    // 检查最新的 10 个日志文件
    for (const logFile of logFiles.slice(0, 10)) {
      if (!fs.existsSync(logFile)) continue;

      const stats = fs.statSync(logFile);
      const fileMtime = stats.mtime.getTime();
      if (fileMtime > latestFileMtime) {
        latestFileMtime = fileMtime;
      }

      // 读取文件尾部 16KB
      const size = stats.size;
      const toRead = Math.min(16 * 1024, size);
      const buffer = Buffer.alloc(toRead);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buffer, 0, toRead, size - toRead);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n');

      // 从后往前搜索状态变化
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];

        if (line.includes('update_session_state')) {
          const runningMatch = line.match(/"state"\s*:\s*"running"/);
          const idleMatch = line.match(/"state"\s*:\s*"idle"/);
          const waitingInputMatch = line.match(/"state"\s*:\s*"waiting_input"/);

          if (runningMatch || idleMatch || waitingInputMatch) {
            const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
            let currentIsRunning = !!runningMatch;

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
          }
        } else if (
          line.includes('Stream started - received first chunk') ||
          line.includes('Starting new request') ||
          line.includes('Creating message') ||
          line.includes('Streaming response') ||
          line.includes('tool_use') ||
          line.includes('thinking') ||
          line.includes('Executing tool') ||
          line.includes('Reading file') ||
          line.includes('Writing file') ||
          line.includes('Executing command') ||
          line.includes('Running tool')
        ) {
          // 活跃活动检测
          const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
          if (timeMatch) {
            const [, year, month, day, hour, min, sec, ms] = timeMatch;
            const timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();
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

    const nowTime = Date.now();
    let hasActiveSession = false;

    // 决策逻辑
    if (lastStateChangeTime > 0) {
      if (lastStateIsRunning) {
        hasActiveSession = (nowTime - lastStateChangeTime) < 5 * 60 * 1000;
      }
      // 状态变为 idle 但之后又有新活动 = 活跃
      else if (lastActivityTime > lastStateChangeTime && (nowTime - lastActivityTime) < 10 * 1000) {
        hasActiveSession = true;
      }
    } else if (latestFileMtime > 0) {
      hasActiveSession = (nowTime - latestFileMtime) < 2 * 60 * 1000;
    }

    return { hasActiveSession, lastStateChangeTime };
  } catch (e) {
    console.error('检查 Claude VSCode 日志失败:', e.message);
    return { hasActiveSession: false, lastStateChange: 0 };
  }
}

/**
 * 检查进程是否有活跃的子进程（工具执行中）
 */
function hasActiveChildren(proc, processes) {
  for (const child of processes) {
    if (child.ppid === proc.pid) {
      const cmd = child.commandLower;
      // 跳过检测工具本身
      if (cmd.includes('grep') || cmd.includes(' ps ') ||
          cmd.includes('eval') || cmd.includes('source') ||
          cmd.includes('/bin/zsh') || cmd.includes('/bin/bash') ||
          cmd.includes('/bin/sh')) {
        continue;
      }
      // 子进程必须本身活跃：正在运行 或者 CPU 不为零
      if (child.stat === 'R' || child.cpu > 0.1) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  id: 'claude-vscode',
  name: 'Claude VSCode',
  description: '检测 VSCode Claude 插件的 AI 活跃状态',

  async detect(processes) {
    // 1. 优先检查日志（最准确）
    const logCheck = checkLogActivity();

    // 2. 检查是否有 Claude 进程（和原 parseProcessList 逻辑完全一致）
    const claudeProcesses = processes.filter(p => {
      const cmd = p.commandLower;
      return (
        // Standard local installation (with or without version number)
        ((cmd.includes('.vscode/extensions/anthropic.claude-code') ||
          cmd.match(/\.vscode\/extensions\/anthropic\.claude-code-[\d.]+/)) &&
          cmd.includes('native-binary/claude'))
      ) || (
        // Remote SSH/WSL development
        (cmd.includes('.vscode-server/') || cmd.includes('.vscode-remote/')) &&
        cmd.includes('claude') &&
        cmd.includes('extensions')
      ) || (
        // Fallback: any VSCode extension Claude with signature
        cmd.includes('claude') &&
        cmd.includes('anthropic') &&
        cmd.includes('extension')
      );
    });

    let processActiveCount = 0;
    for (const proc of claudeProcesses) {
      if (hasActiveChildren(proc, processes)) {
        processActiveCount++;
      }
    }

    // 3. 最终决策
    const activeCount = logCheck.hasActiveSession ? 1 : processActiveCount;

    return {
      activeCount,
      message: claudeProcesses.length > 0 ? `${claudeProcesses.length} 个进程` : '未检测到进程',
      logActive: logCheck.hasActiveSession,
      processCount: claudeProcesses.length,
    };
  },
};
