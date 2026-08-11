import { useState } from 'react';
import { difficultyAt, difficultyForMode, MAX_LEVEL } from '../../sim/difficulty';
import type { GameMode } from '../../sim/types';

interface Props {
  onStart: (mode: GameMode, level: number) => void;
  onBack: () => void;
  highestLevelUnlocked: number;
}

const MODES: { id: GameMode; name: string; blurb: string }[] = [
  { id: 'learning', name: 'Learning', blurb: 'Slow fall, short words, five lives. Build the habit.' },
  { id: 'arcade', name: 'Arcade', blurb: 'Difficulty adapts to how you are actually doing.' },
  { id: 'speedTest', name: 'Speed test', blurb: 'Sixty seconds. Chase the WPM number.' },
  { id: 'accuracy', name: 'Accuracy', blurb: 'Gentler pace — errors are what count here.' },
  { id: 'survival', name: 'Survival', blurb: 'One life. Faster words. No second chances.' },
];

export function LevelSelectScreen({ onStart, onBack, highestLevelUnlocked }: Props) {
  const [mode, setMode] = useState<GameMode>('arcade');
  const maxLevel = Math.max(1, Math.min(MAX_LEVEL, highestLevelUnlocked));
  const [level, setLevel] = useState(1);
  const clampedLevel = Math.min(level, maxLevel);
  const params = difficultyForMode(mode, clampedLevel);
  // What the same level feels like three minutes in, once the ramp has run.
  const late = difficultyAt(mode, clampedLevel, 180);

  return (
    <div className="screen">
      <h2 className="heading">Choose a mode</h2>

      <ul className="modes" role="radiogroup" aria-label="Game mode">
        {MODES.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={`mode ${mode === m.id ? 'mode--selected' : ''}`}
              onClick={() => setMode(m.id)}
            >
              <span className="mode__name">{m.name}</span>
              <span className="mode__blurb">{m.blurb}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="level-picker">
        <label htmlFor="level">
          Starting level <strong>{clampedLevel}</strong>
          {maxLevel < MAX_LEVEL && <span className="hint"> (unlocked to {maxLevel})</span>}
        </label>
        <input
          id="level"
          type="range"
          min={1}
          max={maxLevel}
          value={clampedLevel}
          onChange={(e) => setLevel(Number(e.target.value))}
        />
        <dl className="params">
          <div>
            <dt>Fall speed</dt>
            <dd>{Math.round(params.fallSpeed)} u/s</dd>
          </div>
          <div>
            <dt>Spawn every</dt>
            <dd>{(params.spawnIntervalMs / 1000).toFixed(1)}s</dd>
          </div>
          <div>
            <dt>Word length</dt>
            <dd>
              {params.wordLengthRange[0]}–{params.wordLengthRange[1]}
            </dd>
          </div>
          <div>
            <dt>On screen</dt>
            <dd>
              {params.maxConcurrentWords} → {late.maxConcurrentWords}
            </dd>
          </div>
        </dl>
        <p className="hint">
          Starting values. Words get faster and more frequent the longer a run lasts — after three minutes they
          fall at {Math.round(late.fallSpeed)} u/s, spawning every {(late.spawnIntervalMs / 1000).toFixed(1)}s.
        </p>
      </div>

      <div className="row">
        <button type="button" className="button" onClick={onBack}>
          Back
        </button>
        <button type="button" className="button button--primary" onClick={() => onStart(mode, clampedLevel)}>
          Start
        </button>
      </div>
    </div>
  );
}
