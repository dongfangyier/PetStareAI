/**
 * Qoder CLI 检测器
 * 检测方式: 日志分析 + 子进程活动
 *
 * 活跃状态特征：
 * - model.request.started / loop.iteration.started
 * - input.prompt.submitted
 * - 子进程运行工具
 *
 * 非活跃状态特征：
 * - loop.iteration.finished + end_turn
 * - turn.finished
 * - permission.requested
 * - process.exiting
 */

const fs = require('fs');
const path = require('path');

// Qoder CLI 日志目录
const LOG_BASE_DIR = path.join(require('os').homedir(), '.qoder/logs/runs');

function checkQoderCliLogActivity() {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    return { activeSessionCount: 0 };
  }

  try {
    // 获取所有运行目录，按时间排序（最新的在前）
    const runDirs = fs.readdirSync(LOG_BASE_DIR)
      .filter(f => !f.startsWith('.'))
      .sort()
      .reverse()
      .slice(0, 10); // 最多检查最近 10 个

    const activeSessions = new Set();

    for (const runDir of runDirs) {
      const logFile = path.join(LOG_BASE_DIR, runDir, 'qodercli.log');
      if (!fs.existsSync(logFile)) continue;

      // 读取日志尾部 16KB
      const stats = fs.statSync(logFile);
      const size = stats.size;
      const toRead = Math.min(16 * 1024, size);
      const buffer = Buffer.alloc(toRead);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buffer, 0, toRead, size - toRead);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n');

      let lastActivityTime = 0;
      let lastIdleTime = 0;
      let lastLogTime = 0;

      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
        const line = lines[i];
        if (!line) continue;

        // 解析时间戳
        const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})/);
        let timestamp = 0;
        if (timeMatch) {
          timestamp = new Date(timeMatch[1]).getTime();
          if (timestamp > lastLogTime) lastLogTime = timestamp;
        }

        // 检测停止/空闲标识（优先级高）
        if ((line.includes('loop.iteration.finished') && line.includes('end_turn')) ||
            line.includes('turn.finished') ||
            line.includes('permission.requested') ||
            line.includes('awaiting execution results') ||
            line.includes('process.exiting')) {
          if (timestamp > lastIdleTime) {
            lastIdleTime = timestamp;
          }
        }

        // 检测活跃标识
        if ((line.includes('model.request.started') ||
             line.includes('loop.iteration.started') ||
             line.includes('input.prompt.submitted') ||
             line.includes('tool.shell.started') ||
             line.includes('tool.execution.started')) &&
            timestamp > lastActivityTime) {
          lastActivityTime = timestamp;
        }
      }

      const now = Date.now();
      const isRecentLog = (now - lastLogTime) < 5 * 60 * 1000;
      const isRecentActivity = (now - lastActivityTime) < 60 * 1000; // 1 分钟内有活动
      const isIdleMoreRecent = lastIdleTime > lastActivityTime;

      if (isRecentLog && isRecentActivity && !isIdleMoreRecent) {
        activeSessions.add(runDir);
        console.log(`✓ Qoder CLI session ${runDir.slice(0, 20)}...: BUSY (lastActivity=${Math.round((now - lastActivityTime) / 1000)}s ago)`);
      }
    }

    return { activeSessionCount: activeSessions.size };
  } catch (e) {
    console.error('Error checking Qoder CLI logs:', e.message);
    return { activeSessionCount: 0 };
  }
}

module.exports = {
  id: 'qoder-cli',
  name: 'Qoder CLI',
  description: '检测 Qoder CLI 活跃状态',

  async detect(processes) {
    const logCheck = checkQoderCliLogActivity();

    return {
      activeCount: logCheck.activeSessionCount,
      message: `Qoder CLI ${logCheck.activeSessionCount} 个会话活跃`,
      processCount: processes.filter(p =>
        p.commandLower.includes('qodercli') ||
        p.command.includes('/.qoder/bin/')
      ).length,
    };
  },
};
