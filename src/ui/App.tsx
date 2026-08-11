import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameEngine, type SessionSummary } from '../app/engine';
import type { GameMode } from '../sim/types';
import { GameScreen } from './screens/GameScreen';
import { LevelSelectScreen } from './screens/LevelSelectScreen';
import { MenuScreen } from './screens/MenuScreen';
import { ResultsScreen } from './screens/ResultsScreen';
import { useFsm } from './useFsm';
import { usePreferences } from './usePreferences';

export function App() {
  const engine = useMemo(() => new GameEngine(), []);
  const { screen, go } = useFsm('menu');
  const { preferences, toggle } = usePreferences();
  const [selection, setSelection] = useState<{ mode: GameMode; level: number }>({ mode: 'arcade', level: 1 });
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    engine.onGameOver = (result) => {
      setSummary(result);
      goRef.current('gameOver');
    };
    return () => {
      engine.onGameOver = null;
    };
  }, [engine]);

  // gameOver is a moment, not a screen: hand straight over to the results view.
  useEffect(() => {
    if (screen === 'gameOver') go('results');
  }, [screen, go]);

  // Loading exists so asset/word-bank work has somewhere to live; today it is
  // a single frame that hands off to the playing state.
  useEffect(() => {
    if (screen === 'loading') go('playing');
  }, [screen, go]);

  const startSession = useCallback(
    (mode: GameMode, level: number) => {
      setSelection({ mode, level });
      setSummary(null);
      go('loading');
    },
    [go],
  );

  const quitToMenu = useCallback(() => {
    engine.stop();
    go('menu');
  }, [engine, go]);

  // Pause lives in the FSM, not in a boolean: the engine and the screen state
  // are moved together so they cannot disagree.
  const pause = useCallback(() => {
    engine.pause();
    if (engine.isPaused) go('paused');
  }, [engine, go]);

  const resume = useCallback(() => {
    engine.resume();
    if (!engine.isPaused) go('playing');
  }, [engine, go]);

  return (
    <main className="app">
      {screen === 'menu' && (
        <MenuScreen
          onPlay={() => go('levelSelect')}
          preferences={preferences}
          onTogglePreference={toggle}
          bestWpm={null}
          bestScore={null}
        />
      )}

      {screen === 'levelSelect' && (
        <LevelSelectScreen onStart={startSession} onBack={() => go('menu')} highestLevelUnlocked={30} />
      )}

      {screen === 'loading' && (
        <div className="screen screen--center">
          <p className="loading">Loading…</p>
        </div>
      )}

      {(screen === 'playing' || screen === 'paused' || screen === 'gameOver') && (
        <GameScreen
          engine={engine}
          mode={selection.mode}
          level={selection.level}
          preferences={preferences}
          onPause={pause}
          onResume={resume}
          onQuit={quitToMenu}
        />
      )}

      {screen === 'results' && summary && (
        <ResultsScreen
          summary={summary}
          onPlayAgain={() => {
            go('levelSelect');
            startSession(selection.mode, selection.level);
          }}
          onMenu={() => go('menu')}
        />
      )}
    </main>
  );
}
