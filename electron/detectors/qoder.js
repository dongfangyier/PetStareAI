/**
 * Qoder IDE 检测器
 * 检测方式: 日志分析（状态机）
 *
 * 状态流转：
 * - initial -> prompting -> streaming -> suspended (等待用户选择, 不活跃)
 * - suspended -> streaming (用户恢复后, 重新活跃)
 * - streaming -> completed (完成, 不活跃)
 */

const fs = require('fs');
const path = require('path');

// Qoder 日志目录
const LOG_BASE_DIR = path.join(require('os').homedir(), 'Library/Application Support/Qoder/logs');

/**
 * 检查 Qoder 日志中的活跃状态
 *
 * 活跃状态: prompting, streaming
 * 非活跃状态: initial, suspended, completed
 * 特殊: hasPendingTools = true -> 等待用户选择, 不活跃
 */
function checkQoderLogActivity() {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    return { hasActiveSession: false };
  }

  try {
    // 找到最新的日志目录（按时间排序）
    const logDirs = fs.readdirSync(LOG_BASE_DIR)
      .filter(f => /^\d{8}T\d{6}/.test(f)) // YYYYMMDDTHHMMSS 格式
      .sort()
      .reverse();

    if (logDirs.length === 0) {
      return { hasActiveSession: false };
    }

    // 检查所有 window 的 agent.log
    for (const logDir of logDirs.slice(0, 3)) { // 只检查最近 3 个目录
      const dirPath = path.join(LOG_BASE_DIR, logDir);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      // 找 window* 目录
      const windowDirs = fs.readdirSync(dirPath)
        .filter(f => f.startsWith('window'))
        .sort()
        .reverse();

      for (const windowDir of windowDirs) {
        const agentLog = path.join(dirPath, windowDir, 'agent.log');
        if (!fs.existsSync(agentLog)) continue;

        // 读取日志尾部 16KB
        const stats = fs.statSync(agentLog);
        const size = stats.size;
        const toRead = Math.min(16 * 1024, size);
        const buffer = Buffer.alloc(toRead);
        const fd = fs.openSync(agentLog, 'r');
        fs.readSync(fd, buffer, 0, toRead, size - toRead);
        fs.closeSync(fd);

        const content = buffer.toString('utf8');
        const lines = content.split('\n');

        // 从后往前找状态 - 只看最后 50 行
        let hasPendingTools = false;
        let pendingToolsTime = 0;
        let lastState = null;
        let lastStateTime = 0;
        let lastLogTime = 0;

        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
          const line = lines[i];

          // 解析时间戳
          const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
          let timestamp = 0;
          if (timeMatch) {
            const [, year, month, day, hour, min, sec, ms] = timeMatch;
            timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();
            if (timestamp > lastLogTime) lastLogTime = timestamp;
          }

          // 检查是否有挂起的工具（等待用户选择）
          // 只看最新的状态：如果有 false 就覆盖 true
          if (line.includes('hasPendingTools') && timestamp > pendingToolsTime) {
            pendingToolsTime = timestamp;
            hasPendingTools = line.includes('true');
          }

          // 找到状态转换 - 用最新的时间戳为准
          const stateMatch = line.match(/State transition: (\w+) -> (\w+)/);
          if (stateMatch && timestamp > lastStateTime) {
            const toState = stateMatch[2];
            lastStateTime = timestamp;
            lastState = toState;
          }

          // 检查 Stream Started - 用最新的时间戳为准
          if (line.includes('ACP Stream Started') && timestamp > lastStateTime) {
            lastStateTime = timestamp;
            lastState = 'streaming';
          }

          // 检查 stream completed - 用最新的时间戳为准
          if (line.includes('ACP stream completed') && timestamp > lastStateTime) {
            lastStateTime = timestamp;
            lastState = 'completed';
          }
        }

        // 判断状态
        const now = Date.now();
        const isRecent = (now - lastLogTime) < 5 * 60 * 1000; // 5 分钟内的日志才算

        console.log(`🔍 Qoder: lastState=${lastState}, lastLogTime=${lastLogTime} (${Math.round((now - lastLogTime) / 1000)}s ago), hasPendingTools=${hasPendingTools}, isRecent=${isRecent}`);

        // 如果有挂起的工具（等待用户选择），直接返回不活跃
        if (hasPendingTools) {
          console.log('  Qoder: suspended (waiting for user input)');
          continue;
        }

        if (!hasPendingTools && isRecent && lastState && (lastState === 'prompting' || lastState === 'streaming')) {
          console.log(`✓ Qoder log: BUSY (state=${lastState})`);
          return { hasActiveSession: true };
        }
      }
    }

    return { hasActiveSession: false };
  } catch (e) {
    console.error('Error checking Qoder logs:', e.message);
    return { hasActiveSession: false };
  }
}

module.exports = {
  id: 'qoder',
  name: 'Qoder',
  description: '检测 Qoder IDE 的 AI 活跃状态',

  async detect(processes) {
    // 优先日志检测
    const logCheck = checkQoderLogActivity();

    let activeCount = logCheck.hasActiveSession ? 1 : 0;

    return {
      activeCount,
      message: 'Qoder IDE AI 状态检测',
      processCount: processes.filter(p => p.command.includes('/Applications/Qoder.app')).length,
    };
  },
};
