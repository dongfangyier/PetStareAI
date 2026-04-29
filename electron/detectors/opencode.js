const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * OpenCode Detector - Simple & Accurate
 *
 * Design principle (same as Claude Code):
 * - LOGS ARE THE TRUTH - they directly show if AI is generating
 * - Process detection is only for verification / fallback
 *
 * We don't try to count "instances" because logs are global.
 * We just detect: "is ANY OpenCode actively working?"
 */

const LOG_DIR = path.join(os.homedir(), '.local/share/opencode/log/');

/**
 * Check OpenCode log files for active sessions
 * This is the PRIMARY and MOST RELIABLE indicator
 * Same approach as Claude Code's checkVSCodeLogActivity
 */
function checkOpenCodeLogActivity() {
  if (!fs.existsSync(LOG_DIR)) {
    return { hasActiveSession: false };
  }

  try {
    const now = Date.now();

    // Get all log files sorted by modification time (newest first)
    const logFiles = fs.readdirSync(LOG_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.mtime - a.mtime);

    if (logFiles.length === 0) {
      return { hasActiveSession: false };
    }

    // Check newest log file only - OpenCode only writes to one at a time
    const logFile = path.join(LOG_DIR, logFiles[0].name);

    // If log file wasn't modified in last 30 seconds, definitely idle
    if (now - logFiles[0].mtime > 30000) {
      return { hasActiveSession: false };
    }

    // Read last 50KB of log file (same as Claude Code)
    const stats = fs.statSync(logFile);
    const size = stats.size;
    const toRead = Math.min(50 * 1024, size);
    const buffer = Buffer.alloc(toRead);
    const fd = fs.openSync(logFile, 'r');
    fs.readSync(fd, buffer, 0, toRead, size - toRead);
    fs.closeSync(fd);

    const content = buffer.toString('utf8');
    const lines = content.split('\n');

    // Search from end (newest entries) backwards for state changes
    let lastActivityTime = 0;
    let lastIdleTime = 0;
    let lastSessionComplete = 0;

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];

      // Extract timestamp: INFO  2026-04-28T12:11:28 +1ms ...
      const timeMatch = line.match(/INFO\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
      if (!timeMatch) continue;

      const timestamp = new Date(timeMatch[1]).getTime();

      // ========== ACTIVITY INDICATORS ==========
      // LLM streaming - STRONGEST indicator
      if (line.includes('service=llm') && line.includes('stream')) {
        lastActivityTime = Math.max(lastActivityTime, timestamp);
        continue;
      }

      // Message delta (tokens being generated)
      if (line.includes('message.part.delta')) {
        lastActivityTime = Math.max(lastActivityTime, timestamp);
        continue;
      }

      // Session prompt started
      if (line.includes('session.prompt') && line.includes('status=started')) {
        lastActivityTime = Math.max(lastActivityTime, timestamp);
        continue;
      }

      // ========== IDLE INDICATORS ==========
      // Session completed
      if (line.includes('session.prompt') && line.includes('status=completed')) {
        lastSessionComplete = Math.max(lastSessionComplete, timestamp);
        continue;
      }

      // Session explicitly idle
      if (line.includes('session.idle')) {
        lastIdleTime = Math.max(lastIdleTime, timestamp);
        continue;
      }
    }

    // Decision logic (same as Claude Code):
    // 1. Activity within last 3 seconds AND activity is AFTER last idle → ACTIVE
    // 2. Otherwise → IDLE
    const msSinceActivity = now - lastActivityTime;
    const lastIdleEvent = Math.max(lastIdleTime, lastSessionComplete);

    // Activity happened AND it's recent AND it's after any idle event
    const hasActiveSession =
      lastActivityTime > 0 &&
      msSinceActivity < 3000 &&
      lastActivityTime >= lastIdleEvent;

    console.log(`📝 OpenCode Log: ${hasActiveSession ? 'BUSY' : 'idle'} (last activity ${msSinceActivity}ms ago)`);

    return { hasActiveSession };
  } catch (e) {
    console.error('Error checking OpenCode logs:', e.message);
    return { hasActiveSession: false };
  }
}

/**
 * Check if process is OpenCode (Desktop App or CLI)
 */
function isOpenCodeProcess(p) {
  const cmd = p.commandLower;
  const fullCmd = p.command;

  // Exclude detection tools
  if (cmd.includes('grep') || cmd.includes(' ps ') ||
      cmd.includes('head') || cmd.includes('tail') ||
      cmd.includes('find') || cmd.includes('xargs')) {
    return false;
  }

  // Match OpenCode Desktop App
  const isDesktopApp =
    fullCmd.includes('/Applications/OpenCode.app') ||
    fullCmd.includes('ai.opencode.desktop') ||
    fullCmd.includes('opencode-cli');

  // Match OpenCode CLI (npm package)
  const isCLI =
    (cmd.includes('opencode') || fullCmd.includes('opencode')) &&
    (cmd.includes('/bin/opencode') ||
     cmd.includes('node_modules/opencode') ||
     cmd.includes('opencode-ai') ||
     cmd.includes('.opencode'));

  return isDesktopApp || isCLI;
}

/**
 * Check if helper process is actively working
 * Helper processes = opencode-cli (desktop) OR .opencode (CLI)
 * These do the actual AI work
 */
function isHelperProcessActive(helper) {
  // Running state = actively executing something
  if (helper.stat === 'R') {
    return true;
  }

  // Significant CPU usage = AI is thinking/generating
  // Use high threshold (15%) to avoid idle background CPU noise
  if (helper.cpu > 15.0) {
    return true;
  }

  return false;
}

module.exports = {
  id: 'opencode',
  name: 'OpenCode',

  /**
   * Detect active OpenCode sessions
   *
   * SIMPLE LOGIC (same as Claude Code):
   * 1. Check LOGS first - this is the TRUTH
   * 2. If logs say active, we report active (count=1 minimum)
   * 3. Use process detection to catch cases where logs might be delayed
   * 4. We DO NOT try to count "instances" - just detect activity
   */
  async detect(processes) {
    // Step 1: LOG DETECTION (primary, most reliable)
    const logCheck = checkOpenCodeLogActivity();

    // Step 2: Process detection (secondary, verification)
    // Check if any helper process shows clear signs of activity
    const openCodeProcesses = processes.filter(p => isOpenCodeProcess(p));
    const helperProcesses = openCodeProcesses.filter(p =>
      p.commandLower.includes('opencode-cli') ||
      p.commandLower.includes('/node_modules/.opencode') ||
      p.commandLower.includes('opencode-ai')
    );

    let processActiveCount = 0;
    for (const helper of helperProcesses) {
      if (isHelperProcessActive(helper)) {
        processActiveCount++;
        console.log('✓ OpenCode helper active:', helper.pid, `cpu=${helper.cpu}%`);
      }
    }

    // Step 3: FINAL DECISION
    // If logs say active → 1 minimum (logs are authoritative)
    // OR if any helper is clearly active → count it
    // Max out at 1 to avoid "3 instances" problem (logs are global!)
    let activeCount = 0;

    if (logCheck.hasActiveSession) {
      activeCount = 1;
      console.log('✓ OpenCode log indicates active AI session');
    }

    // Also add any process-detected activity, but cap at reasonable number
    // This handles cases where logging is delayed
    if (processActiveCount > 0 && activeCount === 0) {
      activeCount = processActiveCount;
      console.log('✓ OpenCode process detection indicates activity');
    }

    // Safety cap - it's very unlikely to have more than 2-3 truly active sessions
    activeCount = Math.min(activeCount, 2);

    return {
      activeCount,
      message: openCodeProcesses.length > 0
        ? `${openCodeProcesses.length / 2 | 0} instance(s) running`
        : 'No OpenCode processes'
    };
  }
};
