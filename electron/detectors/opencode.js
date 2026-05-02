/**
 * OpenCode 检测器
 * 检测方式: 日志分析（最准确）+ 子进程活动
 * 参考历史 OpenCode 实现，与 Claude Code 架构保持一致
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// OpenCode 日志目录
const LOG_DIR = path.join(os.homedir(), '.local/share/opencode/log/');

/**
 * 检查 OpenCode 日志中的活跃状态
 * 简化版：只要日志文件最后 10 秒内有修改，且最后 50 行有 delta/stream，没有 idle/completed 在后面
 */
function checkOpenCodeLogActivity() {
  if (!fs.existsSync(LOG_DIR)) {
    return { hasActiveSession: false };
  }

  try {
    const now = Date.now();

    // 获取所有日志文件，按修改时间排序（最新的在前）
    const logFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);

    if (logFiles.length === 0) {
      return { hasActiveSession: false };
    }

    // 日志文件修改时间在 15 秒内 → 可能活跃
    const fileAge = now - logFiles[0].mtime;
    if (fileAge > 15000) {
      return { hasActiveSession: false };
    }

    // 读取最新的日志文件最后 10KB
    const logFile = path.join(LOG_DIR, logFiles[0].name);
    const stats = fs.statSync(logFile);
    const size = stats.size;
    const toRead = Math.min(10 * 1024, size);
    const buffer = Buffer.alloc(toRead);
    const fd = fs.openSync(logFile, 'r');
    fs.readSync(fd, buffer, 0, toRead, size - toRead);
    fs.closeSync(fd);

    const content = buffer.toString('utf8');
    const lines = content.split('\n');

    // 从后往前找，看是先看到 idle/completed/question，还是先看到 delta/stream
    let hasActivity = false;
    let hasIdleAfterActivity = false;
    let isWaitingForUserInput = false;

    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 50); i--) {
      const line = lines[i];

      // 用户正在选择/输入中 - 不算 AI 活跃
      if (line.includes('question.asked') || line.includes('question.asking')) {
        isWaitingForUserInput = true;
        break;
      }

      // 先找到 idle/completed → 后面没有活跃就不算
      if (line.includes('session.idle') ||
          (line.includes('session.prompt') && line.includes('status=completed'))) {
        hasIdleAfterActivity = true;
        break;
      }

      // 找到活跃标识
      if ((line.includes('service=llm') && line.includes('stream')) ||
          line.includes('message.part.delta') ||
          (line.includes('session.prompt') && line.includes('status=started'))) {
        hasActivity = true;
        break;
      }
    }

    const hasActiveSession = hasActivity && !hasIdleAfterActivity && !isWaitingForUserInput;

    if (hasActiveSession) {
      console.log(`✓ OpenCode log: BUSY (file age ${fileAge}ms ago)`);
    }

    return { hasActiveSession };
  } catch (e) {
    console.error('Error checking OpenCode logs:', e.message);
    return { hasActiveSession: false };
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

  /**
   * 检测活跃的 OpenCode 会话
   *
   * 完全依赖日志检测（最准确）:
   * - 移除了进程 R 状态检测，因为不可靠（启动、等待用户输入时都是 R）
   */
  async detect(processes) {
    // 日志检测（唯一权威来源）
    const logCheck = checkOpenCodeLogActivity();

    // 只统计进程数，不做活跃判断
    const openCodeProcesses = processes.filter(p => isOpenCodeProcess(p));

    const activeCount = logCheck.hasActiveSession ? 1 : 0;

    return {
      activeCount,
      message: openCodeProcesses.length > 0
        ? `${openCodeProcesses.length / 2 | 0} 个实例运行中`
        : '未检测到 OpenCode 进程',
      processCount: openCodeProcesses.length,
    };
  },
};
