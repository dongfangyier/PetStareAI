/**
 * Claude 终端检测器
 * 检测方式: 进程运行状态 + 子进程活动 + 会话日志
 * 和原 main.js 逻辑 100% 完全一致
 */

const fs = require('fs');
const path = require('path');

// 终端 Claude 状态滑动窗口 - 解决单次采样漏检问题
const terminalClaudeStateWindow = {};
const TERMINAL_STATE_WINDOW_SIZE = 3;

/**
 * 检查是否有活跃的子进程（工具执行中）
 * 和原逻辑完全一致
 */
function hasActiveChildren(proc, processes) {
  for (const child of processes) {
    if (child.ppid === proc.pid) {
      const cmd = child.commandLower;
      // 跳过检测工具本身
      if (cmd.includes('grep') || cmd.includes(' ps ') ||
          cmd.includes('tail') || cmd.includes('find') ||
          cmd.includes('head')) {
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
  id: 'claude-terminal',
  name: 'Claude Terminal',
  description: '检测终端运行的 Claude CLI 活跃状态',

  async detect(processes) {
    // 进程过滤 - 和原逻辑完全一致
    const terminalClaudeProcesses = processes.filter(p => {
      const cmd = p.commandLower;
      return (cmd === 'claude' || cmd.includes('claude ')) &&
             !cmd.includes('.vscode/') &&
             !cmd.includes('/applications/') &&
             !cmd.includes('claude-code');
    });

    // 会话日志检测 - 和原逻辑完全一致
    let sessionLogActive = false;
    try {
      const projectsDir = require('os').homedir() + '/.claude/projects/';
      if (fs.existsSync(projectsDir)) {
        for (const proc of terminalClaudeProcesses) {
          const sessionPath = require('os').homedir() + `/.claude/sessions/${proc.pid}.json`;
          if (fs.existsSync(sessionPath)) {
            try {
              const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
              const escapedCwd = sessionData.cwd.replace(/\//g, '-');
              const projectPath = projectsDir + escapedCwd + '/' + sessionData.sessionId + '.jsonl';
              if (fs.existsSync(projectPath)) {
                const mtime = fs.statSync(projectPath).mtime.getTime();
                // 3 秒内有写入 = AI 正在生成
                if (Date.now() - mtime < 3000) {
                  sessionLogActive = true;
                  break;
                }
              }
            } catch (e) {}
          }
        }
      }
    } catch (e) {}

    let activeCount = 0;
    const activePids = [];

    // 滑动窗口检测 - 和原逻辑完全一致
    for (const proc of terminalClaudeProcesses) {
      let hasChildren = hasActiveChildren(proc, processes);

      // 初始化或更新滑动窗口
      if (!terminalClaudeStateWindow[proc.pid]) {
        terminalClaudeStateWindow[proc.pid] = [];
      }
      const window = terminalClaudeStateWindow[proc.pid];
      window.unshift(proc.stat === 'R');
      if (window.length > TERMINAL_STATE_WINDOW_SIZE) {
        window.pop();
      }

      const hasRInWindow = window.some(v => v);
      const isActive = hasChildren || hasRInWindow || sessionLogActive;

      if (isActive) {
        activeCount++;
        activePids.push(proc.pid);
      }
    }

    // 清理已经不存在的进程的状态缓存 - 和原逻辑完全一致
    for (const pid of Object.keys(terminalClaudeStateWindow)) {
      if (!terminalClaudeProcesses.find(p => p.pid == pid)) {
        delete terminalClaudeStateWindow[pid];
      }
    }

    return {
      activeCount,
      message: terminalClaudeProcesses.length > 0
        ? `${terminalClaudeProcesses.length} 个终端实例`
        : '未检测到终端 Claude',
      processCount: terminalClaudeProcesses.length,
      activePids,
    };
  },
};
