import React from 'react';
import './CatFace.css';

export const CAT_STATES = {
  IDLE: 'idle',
  BUSY: 'busy',
  SUCCESS: 'success',
  ERROR: 'error',
  SLEEPING: 'sleeping',
};

function CatFace({ state, isHappy = false }) {
  // When isHappy is true, temporarily show happy-play expression
  const effectiveState = isHappy ? 'happy-play' : state;
  const showBlush = state === 'success' || isHappy;

  return (
    <div className={`cat-face cat-face-${effectiveState}`}>
      {/* Ears */}
      <div className="ears">
        <div className="ear left">
          <div className="ear-inner"></div>
        </div>
        <div className="ear right">
          <div className="ear-inner"></div>
        </div>
      </div>

      {/* Whiskers */}
      <div className="whiskers">
        <div className="whisker left top"></div>
        <div className="whisker left middle"></div>
        <div className="whisker left bottom"></div>
        <div className="whisker right top"></div>
        <div className="whisker right middle"></div>
        <div className="whisker right bottom"></div>
      </div>

      {/* Nose */}
      <div className="nose"></div>

      {/* Eyes */}
      <div className="eyes">
        <div className="eye">
          <div className="pupil">
            <div className="pupil-highlight"></div>
          </div>
        </div>
        <div className="eye">
          <div className="pupil">
            <div className="pupil-highlight"></div>
          </div>
        </div>
      </div>

      {/* Mouth / Expression */}
      <div className={`mouth mouth-${effectiveState}`}>
        {(effectiveState === 'success' || effectiveState === 'happy-play') && (
          <div className="mouth-teeth"></div>
        )}
      </div>

      {/* Blush */}
      {showBlush && (
        <div className="blush left"></div>
      )}
      {showBlush && (
        <div className="blush right"></div>
      )}
      {/* Paws */}
      <div className="paws">
        <div className="paw left">
          <div className="toe"></div>
          <div className="toe"></div>
          <div className="toe"></div>
          <div className="toe"></div>
        </div>
        <div className="paw right">
          <div className="toe"></div>
          <div className="toe"></div>
          <div className="toe"></div>
          <div className="toe"></div>
        </div>
      </div>
    </div>
  );
}

export default CatFace;
