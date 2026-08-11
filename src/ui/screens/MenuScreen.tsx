import type { Preferences } from '../usePreferences';

interface Props {
  onPlay: () => void;
  preferences: Preferences;
  onTogglePreference: (key: keyof Preferences) => void;
  bestWpm: number | null;
  bestScore: number | null;
}

export function MenuScreen({ onPlay, preferences, onTogglePreference, bestWpm, bestScore }: Props) {
  return (
    <div className="screen screen--center">
      <h1 className="title">
        Type<span className="title__accent">Rush</span>
      </h1>
      <p className="subtitle">Words fall. Type them before they land.</p>

      {(bestWpm !== null || bestScore !== null) && (
        <p className="menu__bests">
          {bestWpm !== null && <span>Best {Math.round(bestWpm)} WPM</span>}
          {bestScore !== null && <span>High score {bestScore.toLocaleString()}</span>}
        </p>
      )}

      <button type="button" className="button button--primary" onClick={onPlay} autoFocus>
        Play
      </button>

      <fieldset className="options">
        <legend>Accessibility</legend>
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
    </div>
  );
}
