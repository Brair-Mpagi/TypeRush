import { useEffect, useRef } from 'react';
import type { GameEngine } from '../../app/engine';
import { useStore } from '../../app/store';
import { startingLives } from '../../sim/difficulty';
import type { GameMode } from '../../sim/types';
import type { Preferences } from '../usePreferences';
import { Hud } from '../components/Hud';

interface Props {
  engine: GameEngine;
  mode: GameMode;
  level: number;
  preferences: Preferences;
  onPause: () => void;
  onResume: () => void;
  onQuit: () => void;
}

const MODE_LABELS: Record<GameMode, string> = {
  learning: 'Learning',
  arcade: 'Arcade',
  speedTest: 'Speed test',
  accuracy: 'Accuracy',
  survival: 'Survival',
};

export function GameScreen({ engine, mode, level, preferences, onPause, onResume, onQuit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hud = useStore(engine.hud);

  // Attach the renderer and start the session. The loop runs outside React
  // from here on — this effect never re-runs for a HUD update.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    engine.attach(canvas);
    engine.start({ mode, level });
    return () => engine.detach();
  }, [engine, mode, level]);

  useEffect(() => {
    engine.setReducedMotion(preferences.reducedMotion);
  }, [engine, preferences.reducedMotion]);

  useEffect(() => {
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [engine]);

  // Typing is captured at the window so the player never has to click to focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (engine.isPaused) onResume();
        else onPause();
        return;
      }
      if (engine.handleKeyDown(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, onPause, onResume]);

  // A backgrounded tab throttles rAF; pause rather than let the loop free-run (§18).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) onPause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [onPause]);

  return (
    <div className="game">
      <Hud hud={hud} mode={MODE_LABELS[mode]} maxLives={startingLives(mode)} />

      <div className="stage">
        <canvas ref={canvasRef} className="stage__canvas" aria-hidden="true" />

        {/* Parallel accessible layer: canvas text is invisible to assistive tech (§14). */}
        <div className="sr-only" aria-live={preferences.announceWords ? 'assertive' : 'off'} aria-atomic="true">
          {hud.targetWord
            ? `Typing ${hud.targetWord}, ${hud.targetWord.length - hud.typedIndex} letters left`
            : hud.urgentWord
              ? `Next word: ${hud.urgentWord}`
              : ''}
        </div>

        {hud.paused && (
          <div className="overlay" role="dialog" aria-label="Paused">
            <h2>Paused</h2>
            <p className="overlay__hint">Press Escape to resume.</p>
            <div className="row">
              <button type="button" className="button button--primary" onClick={onResume} autoFocus>
                Resume
              </button>
              <button type="button" className="button" onClick={onQuit}>
                Quit to menu
              </button>
            </div>
          </div>
        )}
      </div>

      <p className="footnote">Esc to pause · Backspace to correct</p>
    </div>
  );
}
