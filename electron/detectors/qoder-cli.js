/**
 * Qoder CLI 检测器
 * 检测方式: 日志分析 + 子进程活动
 *
 * 活跃状态特征：
 * - model.request.started / loop.iteration.started
 * - input.prompt.submitted
 * - 子进程运行工具
 */

const fs = require('fs');
const path = require('path');

// Qoder CLI 日志目录
const LOG_BASE_DIR = path.join(require('os').homedir(), '.qoder/logs');

function checkQoderCliLogActivity() {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    return { hasActiveSession: false };
  }

  try {
    const latestLink = path.join(LOG_BASE_DIR, 'latest');
    if (!fs.existsSync(latestLink)) {
      return { hasActiveSession: false };
    }

    // 读取最新日志
    const logFile = path.join(latestLink, 'qodercli.log');
    if (!fs.existsSync(logFile)) {
      return { hasActiveSession: false };
    }

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
          line.includes('awaiting execution results')) {
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
    const isRecentActivity = (now - lastActivityTime) < 30 * 1000; // 30秒内有活动
    // 如果 idle 时间比活跃时间还新 → 不活跃
    const isIdleMoreRecent = lastIdleTime > lastActivityTime;

    console.log(`🔍 Qoder CLI: lastActivity=${lastActivityTime ? Math.round((now - lastActivityTime) / 1000) + 's ago' : 'none'}, lastIdle=${lastIdleTime ? Math.round((now - lastIdleTime) / 1000) + 's ago' : 'none'}, isIdleMoreRecent=${isIdleMoreRecent}`);

    return { hasActiveSession: isRecentLog && isRecentActivity && !isIdleMoreRecent };
  } catch (e) {
    console.error('Error checking Qoder CLI logs:', e.message);
    return { hasActiveSession: false };
  }
}

/**
 * 检查是否有活跃子进程
 */
function hasActiveChildren(proc, processes) {
  for (const child of processes) {
    if (child.ppid === proc.pid) {
      const cmd = child.commandLower;
      // 跳过 shell 和检测工具本身
      if (cmd.includes('/bin/bash') || cmd.includes('/bin/sh') ||
          cmd.includes('/bin/zsh') || cmd.includes('grep')) {
        continue;
      }
      // 子进程运行状态 = 活跃
      if (child.stat === 'R') {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  id: 'qoder-cli',
  name: 'Qoder CLI',
  description: '检测 Qoder CLI 活跃状态',

  async detect(processes) {
    // 日志检测
    const logCheck = checkQoderCliLogActivity();

    // 进程检测：子进程运行
    const qoderProcesses = processes.filter(p =>
      p.commandLower.includes('qodercli') ||
      p.command.includes('/.qoder/bin/')
    );

    let processActive = false;
    for (const p of qoderProcesses) {
      if (hasActiveChildren(p, processes)) {
        processActive = true;
        break;
      }
    }

    const activeCount = (logCheck.hasActiveSession || processActive) ? 1 : 0;

    return {
      activeCount,
      message: qoderProcesses.length > 0 ? `${qoderProcesses.length} 个 Qoder CLI 进程` : '未检测到',
      processCount: qoderProcesses.length,
    };
  },
};
