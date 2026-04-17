# PetStareAI

> 🐱 A desktop pet that monitors your AI tools' running status

PetStareAI is a cute desktop pet that sits on your desktop and keeps track of all your running AI tools. Get quick visual feedback on which AI services are currently active.

## Features

- 🖥️ **Real-time Monitoring**: Monitor multiple AI tools simultaneously
- 🐾 **Draggable Desktop Pet**: Cute, unobtrusive pet that stays on your desktop
- 🎨 **Visual Status Indicators**: Color-coded indicators show running/stopped status
- 🍎 **macOS Support**: Works on both Intel and Apple Silicon Macs
- 🔄 **Auto-refresh**: Automatically updates status at configurable intervals

## Supported AI Tools

- Claude Desktop
- OpenAI ChatGPT (Desktop App)
- Gemini Desktop
- ChatGPT
- Other local AI processes

## Screenshots

[Coming soon]

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Build from source

```bash
# Clone the repository
git clone https://github.com/[your-username]/PetStareAI.git
cd PetStareAI

# Install dependencies
npm install

# Run in development
npm run dev

# Build for production
npm run build
npm run package
```

## Usage

1. Launch PetStareAI
2. The pet will appear on your desktop
3. Drag the pet to position it wherever you like
4. Hover over the status indicators to see tool names
5. The indicators will update automatically showing which AI tools are running

## Development

### Project Structure

```
PetStareAI/
├── CLAUDE.agent/          # Agent documentation and knowledge
│   ├── doc/              # Project documentation
│   ├── skills/           # Development skills tracking
│   └── knowledge/        # Project knowledge base
├── electron/             # Electron main process code
├── src/                  # React frontend code
└── dist/                 # Build output (generated)
```

### Technology Stack

- **Electron**: Desktop application framework
- **React**: UI framework
- **Vite**: Build tool and dev server
- **TypeScript**: Type safety
- **Node.js Process API**: System process monitoring

## License

MIT

## Author

PetStareAI
