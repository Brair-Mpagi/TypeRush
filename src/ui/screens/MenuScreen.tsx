import { useState } from 'react';
import { MIN_WORDS_FOR_RECORD } from '../../persistence/repository';
import type { ProgressRow } from '../../persistence/schema';
import type { Preferences } from '../usePreferences';

interface Props {
  onPlay: () => void;
  preferences: Preferences;
  onTogglePreference: (key: keyof Preferences) => void;
  progress: ProgressRow;
  onClearHistory: () => Promise<void>;
}

export function MenuScreen({ onPlay, preferences, onTogglePreference, progress, onClearHistory }: Props) {
  const [confirmingClear, setConfirmingClear] = useState(false);
  const hasHistory = progress.sessionsPlayed > 0;

  return (
    <div className="screen screen--center">
      <h1 className="title">
        Type<span className="title__accent">Rush</span>
      </h1>
      <p className="subtitle">Type to shoot. Clear the words before they reach your ship.</p>

      {hasHistory && (
        <p className="menu__bests">
          {/* A record needs a long enough run; until then, say so rather than
              showing a zero that reads like broken data. */}
          {progress.bestWpm > 0 ? (
            <>
              <span>Best {Math.round(progress.bestWpm)} WPM</span>
              <span>{(progress.bestAccuracy * 100).toFixed(1)}% accuracy</span>
            </>
          ) : (
            <span>Clear {MIN_WORDS_FOR_RECORD} words in a run to set your first record</span>
          )}
          <span>High score {progress.bestScore.toLocaleString()}</span>
          <span>{progress.xp.toLocaleString()} XP</span>
        </p>
      )}

      <button type="button" className="button button--primary" onClick={onPlay} autoFocus>
        Play
      </button>

      <fieldset className="options">
        <legend>Accessibility</legend>
        <label className="option">
          <input type="checkbox" checked={preferences.sound} onChange={() => onTogglePreference('sound')} />
          Sound effects
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={preferences.reducedMotion}
            onChange={() => onTogglePreference('reducedMotion')}
          />
          Reduce motion
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={preferences.announceWords}
            onChange={() => onTogglePreference('announceWords')}
          />
          Announce words to screen readers
        </label>
        <label className="option">
          <input
            type="checkbox"
            checked={preferences.highContrast}
            onChange={() => onTogglePreference('highContrast')}
          />
          High contrast
        </label>
      </fieldset>

      {hasHistory && (
        <p className="menu__data">
          <span className="hint">
            {progress.sessionsPlayed} sessions · {progress.totalWords.toLocaleString()} words · stored on this device
            only
          </span>
          {confirmingClear ? (
            <>
              <button
                type="button"
                className="button button--small"
                onClick={() => {
                  void onClearHistory().finally(() => setConfirmingClear(false));
                }}
              >
                Delete everything
              </button>
              <button type="button" className="button button--small" onClick={() => setConfirmingClear(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="button button--small" onClick={() => setConfirmingClear(true)}>
              Clear history
            </button>
          )}
        </p>
      )}
    </div>
  );
}
