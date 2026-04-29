<p align="center">
  <strong>中文</strong> | <a href="./README.en.md">English</a>
</p>

---

# PetStareAI - 你的 AI 桌面宠物

agent长任务工作时，你在做什么打发时间？一只可爱的桌面宠物，停留在你的屏幕上监控你的 AI 编程工具。当 AI 在工作时，你可以玩小游戏打发时间！宠物很调皮，有时候会逗你玩～ 宠物始终置顶，可以在任何页面看到 AI 任务是否已经执行完成。

<div align="center">
  <img src="assets/cat-icon.svg" alt="PetStareAI" width="200">
</div>

## ✨ 功能特性

- 🐱 **可爱动画桌面宠物** - 始终置顶在所有窗口之上
- 👀 **实时监控 AI 工具** (可扩展插件架构):
  - ✅ Claude Code (VSCode 扩展)
  - ✅ Claude Code (终端 CLI)
  - ✅ OpenCode CLI
  - 🚧 OpenCode App - 进行中
  - ⚙️ Cursor, Codex, ChatGPT, Gemini, Ollama 等 - 待开发
- 🎮 **等待小游戏** - 当 AI 在运行时，点击弹出的彩球打发时间！
- 😺 **不同状态不同表情**:
  - 空闲：平静呼吸
  - 运行中：紧张等待
  - 睡眠：长时间空闲后打瞌睡
- 🖱️ **完整拖拽** - 把猫拖到桌面任意位置
- ✨ **透明区域点击穿透** - 不阻挡下层应用的点击
- 🕒 **自动睡眠** - 空闲 5 分钟后自动睡眠不挡路
- 📱 **macOS 原生体验** - 没有 Dock 图标，猫始终可见

## 📥 安装

### 下载 DMG

从 [Releases](../../releases) 或者 `dist/`(本地编译) 文件夹下载匹配你 CPU 架构的 DMG：

- **Apple Silicon (M1/M2/M3)**: `dist/PetStareAI-1.0.0-arm64.dmg`
- **Intel**: `dist/PetStareAI-1.0.0.dmg`

### 安装步骤

1. 双击打开 DMG
2. 把 **PetStareAI** 拖到 Applications 文件夹

### 🔧 解决「文件已损坏」问题

因为应用没有签名，macOS 会提示「文件已损坏」，打开「终端」执行以下命令：

```bash
sudo xattr -d com.apple.quarantine /Applications/PetStareAI.app
```

输入你的电脑密码，回车，然后就可以正常打开了。

> 💡 为什么会提示损坏？
> 
> 因为本应用没有经过苹果开发者账号签名公证。
> macOS 的 Gatekeeper 会阻止所有未签名的第三方应用运行，这是正常的安全保护机制，不是文件真的损坏了。
> 执行上面的命令只是告诉系统「我信任这个应用」，不会有任何安全风险。

### 从源码编译

```bash
# 克隆仓库
git clone https://github.com/dongfangyier/PetStareAI.git
cd PetStareAI

# 安装依赖
npm install

# 构建 React 前端
npm run build

# 打包成 DMG (macOS)
npm run package
```

## 🎮 使用说明

1. 启动 PetStareAI
2. 猫会出现在屏幕居中位置
3. **拖拽** 移动到你喜欢的位置
4. **右键** → 退出 可以关闭应用
5. 当 AI 在工作时（繁忙状态），会出现 🎮 按钮 - 点击开始玩小游戏！

### 小游戏玩法

当 AI 繁忙时：
- 点击 🎮 按钮开始游戏 - 窗口从紧凑 80×125 扩展到 180×180
- 彩球随机间隔在随机位置弹出 - 点击它们得分
- 点击成功会显示 **+1 浮动文字动画**
- **游戏中不可以拖拽** 移动猫的位置
- 可以通过菜单按钮 → 退出提前关闭游戏
- AI 工作完成后游戏会自动关闭

### 猫咪状态

| 状态 | 描述 | 表情 |
|------|------|------|
| 空闲 | 没有 AI 在运行 | 正常微笑，缓慢呼吸 |
| 繁忙 | AI 正在工作 | 紧张小嘴 |
| 完成 | 任务完成 | 大大的开心微笑 |
| 睡眠 | 空闲 5 分钟以上 | 闭眼缓慢呼吸 |

## 📁 项目结构

```
PetStareAI/
├── electron/
│   ├── main.js                 # Electron 主进程 - 进程监控、窗口管理、IPC
│   └── detectors/              # 🔌 可扩展插件式检测架构
├── src/
│   ├── components/
│   │   ├── CatFace.jsx         # 带状态表情的动画猫咪
│   │   ├── CatFace.css
│   │   ├── ConfigPanel.jsx     # 配置面板 (预留占位)
│   │   ├── ConfigPanel.css
│   │   └── MiniGame.jsx        # 点击彩球小游戏
│   │   └── MiniGame.css
│   ├── App.jsx                 # 主应用组件
│   ├── App.css
│   ├── main.jsx                # React 入口
│   └── index.css               # 全局样式
├── assets/
│   ├── icon.icns               # macOS 应用图标
│   └── icon.iconset/           # 打包图标文件
├── dist/                       # 打包好的 DMG 文件
├── package.json                # 依赖和构建配置
└── vite.config.js              # Vite 配置
```

## ⚙️ 开发

```bash
# 启动 Vite 开发服务 + Electron
npm run electron:dev

# 仅构建前端
npm run build

# 打包 DMG
npm run electron:build
```

## 📝 待办

- [ ] 添加自定义猫咪主题/皮肤
- [ ] 添加 Lottie 动画让过渡更平滑
- [ ] 更多小游戏
- [ ] 活动追踪统计
- [ ] 配置 GUI 窗口
- [ ] Windows/Linux 支持
- [ ] codex、cursor等其他工具支持

## 📄 许可证

MIT
