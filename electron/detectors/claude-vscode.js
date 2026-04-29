const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Claude Code VSCode Extension Detector
 * Monitors: VSCode Claude extension logs + process activity
 */

// Log file cache - avoid running find command every time
let cachedLogFiles = null;
let lastLogCacheRefresh = 0;
const LOG_CACHE_TTL = 30 * 1000; // 30 seconds

const LOG_BASE_PATH = require('os').homedir() + '/Library/Application Support/Code/logs';

/**
 * Check VSCode Claude extension logs for active sessions
 * This is the most reliable source of state information
 */
function checkLogActivity() {
  if (!fs.existsSync(LOG_BASE_PATH)) {
    return { hasActiveSession: false, lastStateChange: 0 };
  }

  try {
    const now = Date.now();
    let logFiles;

    // Use cached file list if available and fresh
    if (cachedLogFiles && (now - lastLogCacheRefresh) < LOG_CACHE_TTL) {
      logFiles = cachedLogFiles;
    } else {
      // Find all Claude VSCode log files, sorted by modification time, take latest 20
      const findCmd = `find "${LOG_BASE_PATH}" -name "Claude VSCode.log" -type f -print0 | xargs -0 ls -t | head -20`;
      const result = execSync(findCmd, { encoding: 'utf8', timeout: 1000 });
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

    // Check top 10 most recent log files
    for (const logFile of logFiles.slice(0, 10)) {
      if (!fs.existsSync(logFile)) continue;

      const stats = fs.statSync(logFile);
      const fileMtime = stats.mtime.getTime();
      if (fileMtime > latestFileMtime) {
        latestFileMtime = fileMtime;
      }

      // Read last 16KB - enough to find recent state updates
      const size = stats.size;
      const toRead = Math.min(16 * 1024, size);
      const buffer = Buffer.alloc(toRead);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buffer, 0, toRead, size - toRead);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const lines = content.split('\n');

      // Search from end for most recent state updates
      // DO NOT BREAK - because update_session_state might be followed by activity
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.includes('update_session_state')) {
          try {
            const runningMatch = line.match(/"state"\s*:\s*"running"/);
            const idleMatch = line.match(/"state"\s*:\s*"idle"/);
            const waitingInputMatch = line.match(/"state"\s*:\s*"waiting_input"/);

            if (runningMatch || idleMatch || waitingInputMatch) {
              const timeMatch = line.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d+)/);
              let currentIsRunning = !!runningMatch;
              if (waitingInputMatch) currentIsRunning = false;

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
          } catch (e) {
            // ignore parse errors
          }
        } else if (
          line.includes('Stream started - received first chunk') ||
          line.includes('Starting new request') ||
          line.includes('Creating message') ||
          line.includes('Streaming response') ||
          line.includes('tool_use') ||
          line.includes('"type": "thinking"') ||
          line.includes('Executing tool') ||
          line.includes('Reading file') ||
          line.includes('Writing file') ||
          line.includes('Executing command') ||
          line.includes('Running tool') ||
          line.includes('thinking delta')
        ) {
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

    // Decision rules - RESTORED from original main.js (PROVEN RELIABLE)
    // 60s was too short for long-running tasks like "Razzmatazzing... (thinking)"
    if (lastStateChangeTime > 0) {
      // 1. State is explicitly "running" → active for 5 MINUTES (original reliable value)
      if (lastStateIsRunning) {
        hasActiveSession = (nowTime - lastStateChangeTime) < 5 * 60 * 1000;
      }
      // 2. State is idle BUT we have activity AFTER the state change → still working
      // CRITICAL FIX: this was MISSING in the new detector!
      // This handles "update_session_state says idle but Claude is still thinking/tooling"
      else if (lastActivityTime > lastStateChangeTime && (nowTime - lastActivityTime) < 10 * 1000) {
        hasActiveSession = true;
      }
      // 3. Otherwise really idle
      else {
        hasActiveSession = false;
      }
    } else if (latestFileMtime > 0) {
      // Fallback: log was modified in last 2 minutes
      hasActiveSession = (nowTime - latestFileMtime) < 2 * 60 * 1000;
    }

    console.log(`📝 Claude-VSCode: logs=${logFiles.length}, state=${lastStateIsRunning ? 'RUNNING' : 'IDLE'}, active=${hasActiveSession}`);

    return { hasActiveSession, lastStateChangeTime };
  } catch (e) {
    console.error('Error checking Claude VSCode logs:', e.message);
    return { hasActiveSession: false, lastStateChange: 0 };
  }
}

/**
 * Check if a process is VSCode Claude extension
 */
function isVSCodeClaudeProcess(p) {
  return (
    (p.commandLower.includes('.vscode/extensions/anthropic.claude-code') ||
     p.commandLower.match(/\.vscode\/extensions\/anthropic\.claude-code-[\d.]+/)) &&
    p.commandLower.includes('native-binary/claude')
  ) || (
    (p.commandLower.includes('.vscode-server/') ||
     p.commandLower.includes('.vscode-remote/')) &&
    p.commandLower.includes('claude') &&
    p.commandLower.includes('extensions')
  ) || (
    p.commandLower.includes('claude') &&
    p.commandLower.includes('anthropic') &&
    p.commandLower.includes('extension')
  );
}

/**
 * Check if a process has active children (RESTORED from original main.js)
 *
 * IMPORTANT: ORIGINAL logic SKIPS bash/zsh/sh - these are just wrappers, not actual work!
 * The NEW logic tried to detect commands through grandchildren, but this caused false positives
 * because Claude ALWAYS has a shell wrapper when executing ANY command - even when idle waiting.
 *
 * Trusted original design: only count NON-SHELL children that are actually RUNNING or using CPU.
 */
function hasActiveChildren(proc, processes) {
  for (const child of processes) {
    if (child.ppid === proc.pid) {
      const cmd = child.commandLower;
      // Skip detection tools AND shell wrappers (PROVEN in original code!)
      // This is CRITICAL: Claude always has shell processes when executing tools,
      // but the shells themselves are idle until actual commands run.
      if (cmd.includes('grep') || cmd.includes(' ps ') ||
          cmd.includes('eval') || cmd.includes('source') ||
          cmd.includes('/bin/zsh') || cmd.includes('/bin/bash') ||
          cmd.includes('/bin/sh')) {
        continue;
      }
      // Child is active only if: RUNNING state OR measurable CPU usage
      if (child.stat === 'R' || child.cpu > 0.1) {
        return true;
      }
    }
  }
  return false;
}

module.exports = {
  id: 'claude-vscode',
  name: 'Claude Code (VSCode)',

  /**
   * Detect active VSCode Claude sessions
   * @param {Array} processes - Parsed process list
   * @returns {Object} { activeCount: number, message?: string }
   */
  async detect(processes) {
    // First check logs (most reliable)
    const logCheck = checkLogActivity();

    // Then check processes
    const vscodeClaudeProcesses = processes.filter(p => isVSCodeClaudeProcess(p));
    let activeCount = 0;

    for (const proc of vscodeClaudeProcesses) {
      // Only use reliable indicators: has active non-shell children
      const isActive = hasActiveChildren(proc, processes);

      if (isActive) {
        activeCount++;
        console.log('✓ VSCode Claude active:', proc.pid);
      } else {
        console.log('○ VSCode Claude idle:', proc.pid);
      }
    }

    // Fallback: if log says active but processes show none, trust logs
    if (logCheck.hasActiveSession && activeCount === 0 && vscodeClaudeProcesses.length > 0) {
      activeCount = 1;
      console.log('✓ VSCode log indicates active session (fallback)');
    }

    return {
      activeCount,
      message: vscodeClaudeProcesses.length > 0 ? `${vscodeClaudeProcesses.length} process(es) found` : 'No VSCode Claude processes'
    };
  }
};
