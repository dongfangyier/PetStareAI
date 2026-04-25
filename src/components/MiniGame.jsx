import React, { useState, useEffect, useRef, useCallback } from 'react';
import './MiniGame.css';

const BALL_COLORS = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#F38181', '#AA96DA'];

const GAME_CONFIG = {
  maxBalls: 10,
  minSpawnInterval: 800,
  maxSpawnInterval: 1200,
  minBallSize: 15,
  maxBallSize: 28,
  minBallLife: 3000,
  maxBallLife: 5000,
  containerWidth: 180,
  containerHeight: 130,
  padding: 12,
};

function MiniGame({ isActive, score, onScoreChange, onSuccessfulClick, onClose }) {
  const [balls, setBalls] = useState([]);
  const [floatingTexts, setFloatingTexts] = useState([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const spawnTimerRef = useRef(null);
  const cleanupTimerRef = useRef(null);
  const nextSpawnTimeRef = useRef(Date.now());

  const randomInRange = useCallback((min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }, []);

  const spawnBall = useCallback(() => {
    if (balls.length >= GAME_CONFIG.maxBalls) return;

    const size = randomInRange(GAME_CONFIG.minBallSize, GAME_CONFIG.maxBallSize);
    const color = BALL_COLORS[randomInRange(0, BALL_COLORS.length - 1)];

    const x = randomInRange(
      GAME_CONFIG.padding,
      GAME_CONFIG.containerWidth - size - GAME_CONFIG.padding
    );
    const y = randomInRange(
      GAME_CONFIG.padding,
      GAME_CONFIG.containerHeight - size - GAME_CONFIG.padding
    );
    const lifeTime = randomInRange(GAME_CONFIG.minBallLife, GAME_CONFIG.maxBallLife);

    const newBall = {
      id: `${Date.now()}-${Math.random()}`,
      x,
      y,
      size,
      color,
      createdAt: Date.now(),
      lifeTime,
    };

    setBalls(prev => [...prev, newBall]);

    nextSpawnTimeRef.current = Date.now() + randomInRange(
      GAME_CONFIG.minSpawnInterval,
      GAME_CONFIG.maxSpawnInterval
    );
  }, [balls.length, randomInRange]);

  const handleBallClick = useCallback((e, ball) => {
    e.stopPropagation();
    setBalls(prev => prev.filter(b => b.id !== ball.id));

    onScoreChange(score + 1);
    onSuccessfulClick && onSuccessfulClick();
    setFloatingTexts(prev => [...prev, {
      id: `${Date.now()}-${Math.random()}`,
      text: '+1',
      x: ball.x + ball.size / 2,
      y: ball.y,
      createdAt: Date.now(),
    }]);
  }, [score, onScoreChange, onSuccessfulClick]);

  useEffect(() => {
    if (!isActive) {
      if (spawnTimerRef.current) cancelAnimationFrame(spawnTimerRef.current);
      return;
    }

    const spawnLoop = () => {
      if (!isActive) return;

      const now = Date.now();
      if (now >= nextSpawnTimeRef.current) {
        spawnBall();
      }

      spawnTimerRef.current = requestAnimationFrame(spawnLoop);
    };

    spawnTimerRef.current = requestAnimationFrame(spawnLoop);

    return () => {
      if (spawnTimerRef.current) cancelAnimationFrame(spawnTimerRef.current);
    };
  }, [isActive, spawnBall]);

  useEffect(() => {
    if (!isActive) return;

    const cleanupLoop = () => {
      const now = Date.now();

      setBalls(prev => prev.filter(ball => {
        const age = now - ball.createdAt;
        return age < ball.lifeTime;
      }));

      setFloatingTexts(prev => prev.filter(text => {
        const age = now - text.createdAt;
        return age < 800;
      }));

      cleanupTimerRef.current = requestAnimationFrame(cleanupLoop);
    };

    cleanupTimerRef.current = requestAnimationFrame(cleanupLoop);

    return () => {
      if (cleanupTimerRef.current) cancelAnimationFrame(cleanupTimerRef.current);
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      setBalls([]);
      setFloatingTexts([]);
    }
  }, [isActive]);

  const handleMenuToggle = (e) => {
    e.stopPropagation();
    setIsMenuOpen(!isMenuOpen);
  };

  const handleExitClick = (e) => {
    e.stopPropagation();
    onClose && onClose();
  };

  // Close menu when clicking anywhere else
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = () => setIsMenuOpen(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isMenuOpen]);

  return (
    <div className={`mini-game ${isActive ? 'mini-game--active' : ''}`}>
      <div className="mini-game__score">
        <span className="mini-game__score-value">{score}</span>
      </div>

      {isActive && (
        <>
          <button
            className="mini-game__menu-btn"
            onClick={handleMenuToggle}
          >
            ...
          </button>
          {isMenuOpen && (
            <div className="mini-game__dropdown-menu">
              <div
                className="mini-game__menu-item"
                onClick={handleExitClick}
              >
                退出游戏
              </div>
            </div>
          )}
        </>
      )}

      <div className="mini-game__balls">
        {balls.map(ball => (
          <div
            key={ball.id}
            className="mini-game__ball"
            style={{
              left: ball.x,
              top: ball.y,
              width: ball.size,
              height: ball.size,
              backgroundColor: `${ball.color}cc`,
              boxShadow: 'none',
            }}
            onClick={e => handleBallClick(e, ball)}
          />
        ))}
      </div>

      <div className="mini-game__floating-texts">
        {floatingTexts.map(text => {
          const age = Date.now() - text.createdAt;
          const progress = Math.min(age / 800, 1);
          return (
            <div
              key={text.id}
              className="mini-game__floating-text"
              style={{
                left: text.x,
                top: text.y - progress * 30,
                opacity: 1 - progress,
              }}
            >
              {text.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MiniGame;
