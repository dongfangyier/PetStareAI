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

function checkQoderLogActivity() {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    return { activeSessionCount: 0 };
  }

  try {
    // 找到最新的日志目录（按时间排序）
    const logDirs = fs.readdirSync(LOG_BASE_DIR)
      .filter(f => /^\d{8}T\d{6}/.test(f))
      .sort()
      .reverse();

    if (logDirs.length === 0) {
      return { activeSessionCount: 0 };
    }

    const activeSessions = new Set();

    // 检查所有 window 的 agent.log
    for (const logDir of logDirs.slice(0, 3)) {
      const dirPath = path.join(LOG_BASE_DIR, logDir);
      if (!fs.statSync(dirPath).isDirectory()) continue;

      const windowDirs = fs.readdirSync(dirPath)
        .filter(f => f.startsWith('window'))
        .sort()
        .reverse();

      for (const windowDir of windowDirs) {
        const agentLog = path.join(dirPath, windowDir, 'agent.log');
        if (!fs.existsSync(agentLog)) continue;

        const stats = fs.statSync(agentLog);
        const size = stats.size;
        const toRead = Math.min(32 * 1024, size);
        const buffer = Buffer.alloc(toRead);
        const fd = fs.openSync(agentLog, 'r');
        fs.readSync(fd, buffer, 0, toRead, size - toRead);
        fs.closeSync(fd);

        const content = buffer.toString('utf8');
        const lines = content.split('\n');

        // 按 sessionId 记录每个会话的最后状态（从后往前）
        const sessionLastState = new Map(); // sessionId -> { state, timestamp }

        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
          const line = lines[i];

          const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
          if (!timeMatch) continue;
          const [, year, month, day, hour, min, sec, ms] = timeMatch;
          const timestamp = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}`).getTime();

          // 提取 sessionId（支持 sessionId= 和 sessionId: 两种格式）
          const sessionMatch = line.match(/sessionId[=:]\s*([a-f0-9-]+)/);
          if (!sessionMatch) continue;
          const sessionId = sessionMatch[1];

          // 已经确定状态的会话，不需要再往前看了
          if (sessionLastState.has(sessionId)) continue;

          // 忽略 from=load 的历史记录
          if (line.includes('from=load')) continue;

          // 检查 chat_finish 或 stream completed（明确结束）
          if (line.includes('notification type=chat_finish') || line.includes('ACP stream completed')) {
            sessionLastState.set(sessionId, { state: 'completed', timestamp });
            continue;
          }

          // 检查状态转换
          const stateMatch = line.match(/State transition: (\w+) -> (\w+)/);
          if (stateMatch) {
            const toState = stateMatch[2];
            sessionLastState.set(sessionId, { state: toState, timestamp });
            continue;
          }

          // 检查 Stream Started
          if (line.includes('ACP Stream Started')) {
            sessionLastState.set(sessionId, { state: 'streaming', timestamp });
            continue;
          }
        }

        // 判断每个会话
        const now = Date.now();
        for (const [sessionId, stateInfo] of sessionLastState) {
          // 非活跃状态直接跳过
          if (stateInfo.state === 'completed' || stateInfo.state === 'suspended') {
            continue;
          }

          // 5 分钟内的活跃状态才算
          const stateIsRecent = (now - stateInfo.timestamp) < 5 * 60 * 1000;
          const isActiveState = stateInfo.state === 'prompting' || stateInfo.state === 'streaming';

          if (stateIsRecent && isActiveState) {
            activeSessions.add(sessionId);
            console.log(`✓ Qoder session ${sessionId.slice(0, 8)}...: BUSY (state=${stateInfo.state}, ${Math.round((now - stateInfo.timestamp) / 1000)}s ago), window=${windowDir}`);
          }
        }
      }
    }

    return { activeSessionCount: activeSessions.size };
  } catch (e) {
    console.error('Error checking Qoder logs:', e.message);
    return { activeSessionCount: 0 };
  }
}

module.exports = {
  id: 'qoder',
  name: 'Qoder',
  description: '检测 Qoder IDE 的 AI 活跃状态',

  async detect(processes) {
    const logCheck = checkQoderLogActivity();

    return {
      activeCount: logCheck.activeSessionCount,
      message: `Qoder IDE ${logCheck.activeSessionCount} 个会话活跃`,
      processCount: processes.filter(p => p.command.includes('/Applications/Qoder.app')).length,
    };
  },
};
