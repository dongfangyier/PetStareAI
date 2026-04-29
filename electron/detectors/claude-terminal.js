/**
 * Claude Code Terminal Detector
 * Monitors: Terminal claude command processes
 */

/**
 * Check if a process is terminal Claude Code (not VSCode extension)
 */
function isTerminalClaude(p) {
  const cmd = p.commandLower;
  // Match 'claude' command in terminal, but exclude VSCode extensions and apps
  return (cmd === 'claude' || cmd.includes('claude ')) &&
         !cmd.includes('.vscode/') &&
         !cmd.includes('/applications/') &&
         !cmd.includes('claude-code');
}

/**
 * Check if a process has active children (including shells executing commands)
 * SPECIALIZED for Terminal Claude: ANY non-detection-tool child = running a command
 *
 * For Terminal Claude:
 * - If Claude spawns ANY child (bash/zsh/sleep/ls/etc.), it's executing a command
 * - Commands like `sleep 10` have stat=S and 0% CPU but are still "running"
 * - We just need to exclude detection tools (grep/ps/etc.) from our own checking
 */
function hasActiveChildren(proc, processes) {
  for (const child of processes) {
    if (child.ppid === proc.pid) {
      const cmd = child.commandLower;
      // Skip ONLY the internal detection tools (grep, ps, etc.)
      // DO NOT skip bash/zsh/sh/sleep - Claude is actively executing these!
      if (cmd.includes('grep') || cmd.includes(' ps ') ||
          cmd.includes('tail') || cmd.includes('find') ||
          cmd.includes('head')) {
        continue;
      }
      // For Terminal Claude: HAVING a non-tool child = command is running
      // Commands like sleep, npm, git all have children that may sleep but ARE active
      return true;
    }
  }
  return false;
}

module.exports = {
  id: 'claude-terminal',
  name: 'Claude Code (Terminal)',

  /**
   * Detect active terminal Claude sessions
   * @param {Array} processes - Parsed process list
   * @returns {Object} { activeCount: number, message?: string }
   */
  async detect(processes) {
    const terminalClaudeProcesses = processes.filter(p => isTerminalClaude(p));
    let activeCount = 0;

    for (const proc of terminalClaudeProcesses) {
      // Terminal claude: running OR has active children (shell commands)
      // This fixes detection of Bash(sleep 10), Bash(yes > /dev/null), etc.
      // where Claude sleeps (S) but children do the actual work
      const isActive = proc.stat === 'R' || hasActiveChildren(proc, processes);
      if (isActive) {
        activeCount++;
        console.log('✓ Terminal Claude active:', proc.pid);
      } else {
        console.log('○ Terminal Claude idle:', proc.pid);
      }
    }

    return {
      activeCount,
      message: terminalClaudeProcesses.length > 0 ? `${terminalClaudeProcesses.length} process(es) found` : 'No terminal Claude processes'
    };
  }
};
