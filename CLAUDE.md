# PetStareAI - Project for Claude Code

This is a desktop pet application that monitors AI coding tools and entertains you while waiting.

## Build Commands

- `npm install` - Install dependencies
- `npm run dev` - Start Vite dev server
- `npm run build` - Build React frontend to `dist/`
- `npm run electron:dev` - Start Vite + Electron for development
- `npm run electron:build` - Build frontend and package into DMG installer
- `npm run package` - Package with electron-builder only

## Project Structure

- `electron/main.js` - Electron main process: process monitoring, window management, IPC
- `electron/detectors/` - 🔌 Extensible detector plugin architecture
- `src/App.jsx` - Main React component, handles state and IPC
- `src/components/CatFace.jsx` - Animated cat face with 5 states
- `src/components/MiniGame.jsx` - Click-to-pop balls mini-game for when AI is busy
- `src/components/ConfigPanel.jsx` - Configuration modal (placeholder)
- `assets/` - Icons and assets for packaging
- `dist/` - Build output (DMG files)

## Key Features

- Multi-tool AI monitoring (extensible plugin architecture)
  - ✅ Claude Code (VSCode extension)
  - ✅ Claude Code (terminal CLI)
  - ✅ OpenCode CLI
  - ✅ Qoder IDE
  - ✅ Qoder CLI
  - 🚧 OpenCode App - In progress
  - ⚙️ Cursor, Codex, ChatGPT, Gemini, Ollama and more - Planned
- The cat is playful! It might tease you sometimes 😺
- Animated cat expressions for each state (idle/busy/success/error/sleeping)
- Mini-game: click popping balls while waiting for AI
- Draggable, always-on-top, transparent window
- Click-through on transparent areas
- Auto-sleep after 5 minutes idle
- Built for macOS (universal binary: arm64 + x64 DMG)

## Implementation Notes

- **Process detection**: Combines `ps` parsing + VSCode Claude extension log parsing
- **VSCode log detection**: Checks last 20 recent log files, reads tail for `update_session_state` entries
- **Anti-jitter debouncing**: Requires 2 consecutive inactive checks before switching to idle
- **Window sizing**: 80x125 compact (cat only), 180x180 full (with mini-game)
- **No dock icon**: app.dock.hide() on macOS - right-click cat to quit
- **No tray icon**: Tray icon removed per request - cat is always visible on desktop

## 🔌 Detector Plugin Development Guide (可复用经验)

### 新增 AI 工具检测器标准流程

**Step 1: 探测目标工具的运行特征**
```bash
# 1. 查看进程特征
ps aux | grep -i [tool_name]

# 2. 查找日志目录
find ~/.local/share -name "*[tool_name]*" -type d 2>/dev/null
find ~/Library/Application\ Support -name "*[tool_name]*" -type d 2>/dev/null
find ~/.[tool_name]* -type d 2>/dev/null

# 3. 查看日志内容
tail -f [log_file]
```

**Step 2: 识别活跃/空闲状态的日志特征**

| 状态 | 常见关键词 | 说明 |
|------|------------|------|
| **活跃 (Busy)** | `request.started`, `stream.started`, `loop.iteration.started`, `model.request`, `tool.*.started` | 开始请求/思考/工具调用 |
| **空闲 (Idle)** | `*.finished`, `*.completed`, `end_turn`, `idle`, `awaiting` | 请求完成/会话结束 |
| **等待用户** | `permission.requested`, `hasPendingTools`, `awaiting.*user` | 用户选择/授权确认中 → 算空闲 |

**Step 3: 创建检测器插件模板**

```javascript
/**
 * [ToolName] 检测器
 */
const fs = require('fs');
const path = require('path');

// 日志基目录
const LOG_BASE_DIR = path.join(require('os').homedir(), 'path/to/logs');

function checkLogActivity() {
  if (!fs.existsSync(LOG_BASE_DIR)) {
    return { hasActiveSession: false };
  }

  try {
    // 找到最新日志
    // 读取尾部 16KB
    // 从后往前遍历最后 100 行

    let lastActivityTime = 0;
    let lastIdleTime = 0;
    let lastLogTime = 0;

    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
      // 解析时间戳
      // 检测活跃标识 → 更新 lastActivityTime
      // 检测空闲标识 → 更新 lastIdleTime
    }

    // 核心判断逻辑（优先级）
    const now = Date.now();
    const isRecentLog = (now - lastLogTime) < 5 * 60 * 1000;       // 5分钟内有日志
    const isRecentActivity = (now - lastActivityTime) < 30 * 1000;  // 30秒内有活动
    const isIdleMoreRecent = lastIdleTime > lastActivityTime;       // Idle 日志更新则为空闲

    return { hasActiveSession: isRecentLog && isRecentActivity && !isIdleMoreRecent };
  } catch (e) {
    return { hasActiveSession: false };
  }
}

module.exports = {
  id: '[tool_name]',       // 小写+连字符，如 qoder-cli
  name: '[Tool Name]',     // 显示名，如 Qoder CLI
  description: '描述',

  async detect(processes) {
    // 日志检测为主（最准确）
    const logCheck = checkLogActivity();

    // 进程/子进程检测为辅（兜底）
    const targetProcesses = processes.filter(p => ...);
    let processActive = false;

    const activeCount = (logCheck.hasActiveSession || processActive) ? 1 : 0;

    return { activeCount, message: '...', processCount: targetProcesses.length };
  },
};
```

**Step 4: 在 main.js 中添加计数**

```javascript
const [toolId]Result = detectionResult.results.find(r => r.id === '[tool_id]');
const [toolId]ActiveCount = [toolId]Result ? [toolId]Result.activeCount : 0;

// 加入总数
const totalTaskCount = ... + [toolId]ActiveCount;

// 加入显示
if (result.id === '[tool_id]') displayCount = [toolId]ActiveCount;
```

### 检测器最佳实践

1. **日志为主，进程为辅**：日志是最准确的状态来源，进程/CPU 检测只做兜底
2. **⚠️ 绝对不要依赖进程 R 状态**：CLI 工具启动时、等待用户输入时都是 `stat=R`，会造成严重误判
3. **优先检测 idle 状态**：Idle 日志比活跃日志优先级更高（避免假活跃）
4. **等待用户不算活跃**：`permission.requested` / `hasPendingTools=true` 一律算 idle
5. **只看最后 N 行**：避免被历史日志干扰（通常 50-100 行足够）
6. **添加调试日志**：打印 `lastActivity` / `lastIdle` 时间，方便排查问题
7. **文件大小兜底**：只读日志尾部 16KB，避免大文件卡顿

### 🚀 多会话检测（高级主题）

**问题背景**：一个 AI 工具可能同时运行多个会话（多窗口/多标签页），需要正确统计活跃会话数。

**各工具的日志模式与解决方案**：

| 工具 | 日志模式 | 解决方案 | 关键点 |
|------|----------|----------|--------|
| **Claude VSCode** | 多文件（每个窗口一个日志），每个文件内按 `sessionId` 区分 | 按 `sessionId` 分组，每个会话独立判断状态 | `"sessionId":"..."` 在 `update_session_state` 行中 |
| **Qoder IDE** | 单文件内多会话，`sessionId` 分布在不同行 | 按 `sessionId` 分组追踪，`State transition:` 行带状态 | `sessionId` 在 `ACP Stream Started` 等行中 |
| **Qoder CLI** | 多目录（每个进程一个日志目录） | 遍历 `~/.qoder/logs/runs/` 下的所有目录，每个目录独立判断 | 每个目录对应一个独立会话 |
| **Claude Terminal** | 多进程（每个终端一个进程） | 按 pid 匹配会话日志，每个进程独立判断 | `session.{pid}.json` 映射到项目日志 |
| **OpenCode** | ⚠️ 单文件多会话，但关键行**不带 sessionId** | 近似方案：追踪每个 session 最后一次 `service=llm ... stream` 行号，对比全局最后 idle 行号 | `message.part.delta` 和 `session.idle` 行都不带 sessionId |

**OpenCode 的特殊坑（最复杂）**：

```text
# 活跃标识行（带 sessionId）：
INFO ... service=llm ... session.id=ses_xxx ... stream

# 但是！内容输出行和结束行都不带 sessionId：
INFO ... service=bus type=message.part.delta publishing  ❌ 不带 sessionId
INFO ... service=bus type=session.idle publishing          ❌ 不带 sessionId
```

**解决方案**：只能用近似算法 - 每个会话最后一次 stream 的行号 vs 全局最后一次 idle 的行号。

**检测不到的常见原因排查**：

| 现象 | 可能原因 | 修复 |
|------|----------|------|
| 多个窗口只检测到 1 个 | 只检测了最新日志文件，没有遍历所有 | 遍历所有最近的日志文件/目录 |
| 一直检测到 0 个 | 时间戳解析时区问题 | 不要解析日志内的时间戳，改用文件 mtime 或行号对比 |
| 会话结束了还显示活跃 | 结束状态的正则不匹配 | 打印最后 20 行确认结束标识 |
| 还没开始就显示活跃 | from=load 的历史记录被误判 | 过滤含 `from=load` 的行（Qoder） |

## Packaging Output

- `dist/PetStareAI-1.0.0-arm64.dmg` - Apple Silicon installer
- `dist/PetStareAI-1.0.0.dmg` - Intel installer
- `dist/mac-arm64/PetStareAI.app` - ARM64 app bundle
- `dist/mac/PetStareAI.app` - Intel app bundle
