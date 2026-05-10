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
 * 支持多窗口、多会话检测
 */
function checkLogActivity() {
  if (!fs.existsSync(LOG_BASE_PATH)) {
    return { activeSessionCount: 0 };
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
      return { activeSessionCount: 0 };
    }

    const sessionStates = new Map(); // sessionId -> { state, timestamp }

    // 检查所有日志文件（按时间从新到旧）
    for (const logFile of logFiles.slice(0, 10)) {
      if (!fs.existsSync(logFile)) continue;

      const stats = fs.statSync(logFile);
      const size = stats.size;
      const toRead = Math.min(16 * 1024, size);
      const buffer = Buffer.alloc(toRead);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buffer, 0, toRead, size - toRead);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n');

      // 从后往前遍历（最新的在前）
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
        const line = lines[i];

        // 只处理 update_session_state 状态变化
        if (!line.includes('update_session_state')) continue;

        // 提取 sessionId 和 state
        const sessionMatch = line.match(/"sessionId"\s*:\s*"([^"]+)"/);
        if (!sessionMatch) continue;
        const sessionId = sessionMatch[1];

        // 这个会话已经确定过状态了，不需要再往前看（因为从后往前）
        if (sessionStates.has(sessionId)) continue;

        const isRunning = line.includes('"state":"running"');
        const isIdle = line.includes('"state":"idle"');
        const isWaiting = line.includes('"state":"waiting_input"');

        if (!isRunning && !isIdle && !isWaiting) continue;

        // 解析时间戳
        const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
        let timestamp = stats.mtime.getTime();
        if (timeMatch) {
          const [, year, month, day, hour, min, sec, ms] = timeMatch;
          timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();
        }

        sessionStates.set(sessionId, { state: isRunning ? 'running' : 'idle', timestamp });
      }
    }

    // 统计活跃会话数
    let activeSessionCount = 0;
    for (const [sessionId, stateInfo] of sessionStates) {
      const stateIsRecent = (now - stateInfo.timestamp) < 5 * 60 * 1000;
      if (stateInfo.state === 'running' && stateIsRecent) {
        activeSessionCount++;
        console.log(`✓ VSCode session ${sessionId.slice(0, 8)}...: BUSY (${Math.round((now - stateInfo.timestamp) / 1000)}s ago)`);
      }
    }

    return { activeSessionCount };
  } catch (e) {
    console.error('检查 Claude VSCode 日志失败:', e.message);
    return { activeSessionCount: 0 };
  }
}

module.exports = {
  id: 'claude-vscode',
  name: 'Claude VSCode',
  description: '检测 VSCode Claude 插件的 AI 活跃状态',

  async detect(processes) {
    // 1. 优先检查日志（最准确）
    const logCheck = checkLogActivity();

    // 2. 检查进程数（仅用于展示）
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

    return {
      activeCount: logCheck.activeSessionCount,
      message: `VSCode ${logCheck.activeSessionCount} 个会话活跃`,
      logActive: logCheck.activeSessionCount > 0,
      processCount: claudeProcesses.length,
    };
  },
};
