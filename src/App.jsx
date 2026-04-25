import React, { useState, useEffect } from 'react';
const { ipcRenderer } = window.require('electron');
import CatFace, { CAT_STATES } from './components/CatFace';
import ConfigPanel from './components/ConfigPanel';
import MiniGame from './components/MiniGame';
import './App.css';

// Claude Code working status
export const CLAUDE_STATES = {
  IDLE: CAT_STATES.IDLE,
  RUNNING: CAT_STATES.BUSY,
  SUCCESS: CAT_STATES.SUCCESS,
  ERROR: CAT_STATES.ERROR,
  SLEEPING: CAT_STATES.SLEEPING,
  PLAYING: 'playing', // Minigame state
};

function App() {
  const [claudeState, setClaudeState] = useState(CLAUDE_STATES.IDLE);
  const [taskCount, setTaskCount] = useState(0);
  const [configOpen, setConfigOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [isMiniGameActive, setIsMiniGameActive] = useState(false);
  const [miniGameScore, setMiniGameScore] = useState(0);
  const [isCatHappy, setIsCatHappy] = useState(false);

  // Check for idle/sleeping transition
  useEffect(() => {
    const timer = setInterval(() => {
      const idleTime = Date.now() - lastActivity;
      // If idle for 5 minutes, go to sleep
      if (claudeState === CLAUDE_STATES.IDLE && idleTime > 5 * 60 * 1000) {
        setClaudeState(CLAUDE_STATES.SLEEPING);
      }
    }, 10000);

    return () => clearInterval(timer);
  }, [claudeState, lastActivity]);

  useEffect(() => {
    console.log('App mounted, CLAUDE_STATES:', CLAUDE_STATES);

    // Listen for Claude status updates from main process
    const handleClaudeStatus = (event, result) => {
      console.log('Received claude-status event, result:', result);
      // Handle new format: { status, taskCount }
      const status = typeof result === 'object' ? result.status : result;
      const count = typeof result === 'object' ? result.taskCount : 0;

      console.log('Parsed - status:', status, 'taskCount:', count);

      setClaudeState(status);
      setTaskCount(count);
      setLastActivity(Date.now());

      // If not running anymore, stop the mini-game automatically
      if (status !== CLAUDE_STATES.RUNNING) {
        setIsMiniGameActive(false);
      }

      // If we just finished, go back to idle after a delay
      if (status === CLAUDE_STATES.SUCCESS || status === CLAUDE_STATES.ERROR) {
        setTimeout(() => {
          setClaudeState(CLAUDE_STATES.IDLE);
          setLastActivity(Date.now());
        }, 5000);
      }
    };

    ipcRenderer.on('claude-status', handleClaudeStatus);

    // Get initial status
    ipcRenderer.invoke('get-claude-status').then((result) => {
      console.log('Initial status result:', result);
      const status = typeof result === 'object' ? result.status : result;
      const count = typeof result === 'object' ? result.taskCount : 0;

      console.log('Parsed initial - status:', status, 'taskCount:', count);

      setClaudeState(status);
      setTaskCount(count);
      setLastActivity(Date.now());
    });

    return () => {
      ipcRenderer.removeListener('claude-status', handleClaudeStatus);
    };
  }, [isMiniGameActive]);

  // Adjust window size when mini-game active state changes
  useEffect(() => {
    const sizeMode = isMiniGameActive ? 'full' : 'compact';
    ipcRenderer.send('set-window-size', sizeMode);
    console.log(`Window size changed to: ${sizeMode}`);
  }, [isMiniGameActive]);

  const handleCatClick = () => {
    console.log('Cat clicked. claudeState:', claudeState, 'CLAUDE_STATES.RUNNING:', CLAUDE_STATES.RUNNING, 'isMiniGameActive:', isMiniGameActive);
    setLastActivity(Date.now());
    if (claudeState === CLAUDE_STATES.SLEEPING) {
      setClaudeState(CLAUDE_STATES.IDLE);
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu');
  };

  return (
    <div className="pet-container">
      {/* Dragable background area - entire container except pet-body */}
      <div
        className="pet-drag-area"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      ></div>
      <div
        className="pet-body"
        onClick={handleCatClick}
        onContextMenu={handleContextMenu}
      >
        <CatFace state={claudeState} isHappy={isCatHappy} />
        {isMiniGameActive && (
          <MiniGame
            isActive={isMiniGameActive}
            score={miniGameScore}
            onScoreChange={setMiniGameScore}
            onSuccessfulClick={() => {
              setIsCatHappy(true);
              setTimeout(() => setIsCatHappy(false), 500);
            }}
            onClose={() => setIsMiniGameActive(false)}
          />
        )}
        {isHovered && claudeState !== CLAUDE_STATES.RUNNING && (
          <div className="status-info">
            <div className="status-text">
              Claude: {getStateName(claudeState)}
            </div>
          </div>
        )}
        {claudeState === CLAUDE_STATES.RUNNING && (
          <>
            <div className="loading-container">
              <div className="loading-spinner">
                <div className="loading-spinner-circle"></div>
                <div className="task-count">
                  {taskCount}
                </div>
              </div>
            </div>
            {!isMiniGameActive && (
              <button
                className="start-game-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMiniGameActive(true);
                  setMiniGameScore(0);
                }}
              >
                🎮
              </button>
            )}
          </>
        )}
      </div>
      <ConfigPanel
        isOpen={configOpen}
        onClose={() => setConfigOpen(false)}
      />
    </div>
  );
}

function getStateName(state) {
  switch (state) {
    case CLAUDE_STATES.IDLE: return 'Idle';
    case CLAUDE_STATES.RUNNING: return 'Working...';
    case CLAUDE_STATES.SUCCESS: return 'Done ✓';
    case CLAUDE_STATES.ERROR: return 'Failed ✗';
    case CLAUDE_STATES.SLEEPING: return 'Sleeping 😴';
    default: return 'Unknown';
  }
}

export default App;
