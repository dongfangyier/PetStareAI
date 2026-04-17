import React, { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';

const AI_TOOLS = [
  { id: 'claude', name: 'Claude', emoji: '🧠' },
  { id: 'chatgpt', name: 'ChatGPT', emoji: '💬' },
  { id: 'gemini', name: 'Gemini', emoji: '⭐' },
  { id: 'cursor', name: 'Cursor', emoji: '🖱️' },
  { id: 'vscode', name: 'VS Code', emoji: '💻' },
  { id: 'ollama', name: 'Ollama', emoji: '🦙' },
  { id: 'lmstudio', name: 'LM Studio', emoji: '🧪' },
];

function App() {
  const [runningTools, setRunningTools] = useState([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    // Listen for status updates from main process
    const handleStatusUpdate = (event, running) => {
      setRunningTools(running);
    };

    ipcRenderer.on('status-update', handleStatusUpdate);

    // Get initial status
    ipcRenderer.invoke('get-initial-tools').then((running) => {
      setRunningTools(running);
    });

    return () => {
      ipcRenderer.removeListener('status-update', handleStatusUpdate);
    };
  }, []);

  const handleQuit = () => {
    ipcRenderer.send('quit');
  };

  const isRunning = (toolId) => {
    return runningTools.includes(toolId);
  };

  return (
    <div className="pet-container">
      <div className="pet-body">
        <button className="close-btn" onClick={handleQuit} title="Quit PetStareAI">
          ×
        </button>
        <div className="pet-title">PetStareAI</div>
        <div className="pet-face">
          <div className="eye"></div>
          <div className="eye"></div>
        </div>
        <div className="pet-mouth"></div>
        <div className="status-grid">
          {AI_TOOLS.map((tool) => (
            <div
              key={tool.id}
              className="status-item"
              data-tooltip={tool.name}
              title={tool.name}
            >
              <div
                className={`status-dot ${isRunning(tool.id) ? 'running' : 'stopped'}`}
              ></div>
              <span className="status-label">{tool.emoji}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;
