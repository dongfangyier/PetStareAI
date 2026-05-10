/**
 * OpenCode 检测器
 * 检测方式: 日志分析（最准确）
 *
 * 难点：session.idle 行不带 sessionId，无法准确知道结束的是哪个
 * 近似方案：追踪每个 session 最后一次 stream 的行号，对比最后一次 idle 的行号
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// OpenCode 日志目录
const LOG_DIR = path.join(os.homedir(), '.local/share/opencode/log/');

/**
 * 检查 OpenCode 日志中的活跃状态
 */
function checkOpenCodeLogActivity() {
  if (!fs.existsSync(LOG_DIR)) {
    return { activeSessionCount: 0 };
  }

  try {
    const now = Date.now();

    // 获取所有日志文件，按修改时间排序（最新的在前）
    const logFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5); // 最多检查最近 5 个文件

    const sessionLastStream = new Map(); // sessionId -> last stream line
    let lastIdleLine = -1; // 最后一次 idle 的行号

    for (const logFile of logFiles) {
      // 30 秒以上没有更新的跳过
      if (now - logFile.mtime > 30000) continue;

      const filePath = path.join(LOG_DIR, logFile.name);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').slice(-100); // 只看最后 100 行

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // stream 开始（带 sessionId）
        if (line.includes('service=llm') && line.includes('stream')) {
          const sessionMatch = line.match(/session.id=([^ \n]+)/);
          if (sessionMatch) {
            sessionLastStream.set(sessionMatch[1], i);
          }
        }

        // session idle（不带 sessionId，只能记录全局最后位置）
        if (line.includes('session.idle') ||
            line.includes('question.asked')) {
          lastIdleLine = i;
        }
      }
    }

    // 对每个 session 判断：stream 行号 > idle 行号 = 活跃
    let activeCount = 0;
    for (const [sessionId, streamLine] of sessionLastStream) {
      if (streamLine > lastIdleLine) {
        activeCount++;
        console.log(`✓ OpenCode session ${sessionId.slice(0, 15)}...: BUSY (stream@line=${streamLine}, idle@line=${lastIdleLine})`);
      }
    }

    return { activeSessionCount: activeCount };
  } catch (e) {
    console.error('Error checking OpenCode logs:', e.message);
    return { activeSessionCount: 0 };
  }
}

/**
 * 判断是否是 OpenCode 进程（桌面应用或 CLI）
 */
function isOpenCodeProcess(p) {
  const cmd = p.commandLower;
  const fullCmd = p.command;

  // 排除检测工具本身
  if (cmd.includes('grep') || cmd.includes(' ps ') ||
      cmd.includes('head') || cmd.includes('tail') ||
      cmd.includes('find') || cmd.includes('xargs')) {
    return false;
  }

  // 匹配 OpenCode 桌面应用
  const isDesktopApp =
    fullCmd.includes('/Applications/OpenCode.app') ||
    fullCmd.includes('ai.opencode.desktop') ||
    fullCmd.includes('opencode-cli');

  // 匹配 OpenCode CLI（npm 包）
  const isCLI =
    (cmd.includes('opencode') || fullCmd.includes('opencode')) &&
    (cmd.includes('/bin/opencode') ||
     cmd.includes('node_modules/opencode') ||
     cmd.includes('opencode-ai') ||
     cmd.includes('.opencode'));

  return isDesktopApp || isCLI;
}

module.exports = {
  id: 'opencode',
  name: 'OpenCode',
  description: '检测 OpenCode AI 工具的活跃状态',

  async detect(processes) {
    // 日志检测（唯一权威来源）
    const logCheck = checkOpenCodeLogActivity();

    // 只统计进程数，不做活跃判断
    const openCodeProcesses = processes.filter(p => isOpenCodeProcess(p));

    return {
      activeCount: logCheck.activeSessionCount,
      message: `OpenCode ${logCheck.activeSessionCount} 个会话活跃`,
      processCount: openCodeProcesses.length,
    };
  },
};
