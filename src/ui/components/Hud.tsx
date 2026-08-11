import type { HudSnapshot } from '../../app/engine';

interface Props {
  hud: HudSnapshot;
  mode: string;
  maxLives: number;
}

export function Hud({ hud, mode, maxLives }: Props) {
  return (
    <div className="hud">
      <div className="hud__group">
        <Stat label="Score" value={hud.score.toLocaleString()} />
        <Stat label="WPM" value={String(hud.wpm)} />
        <Stat label="Accuracy" value={`${hud.accuracy.toFixed(1)}%`} />
      </div>

      <div className="hud__group hud__group--center">
        <span className="hud__mode">{mode}</span>
        <span className="hud__level">
          Level {hud.level}
          {hud.ramp > 1 && (
            <span className="hud__ramp" title="Words speed up the longer you last">
              {' '}
              ×{hud.ramp.toFixed(1)} speed
            </span>
          )}
        </span>
        {hud.combo > 0 && (
          <span className="hud__combo" data-multiplier={hud.multiplier}>
            {hud.combo} combo ×{hud.multiplier}
          </span>
        )}
      </div>

      <div className="hud__group hud__group--right">
        <Stat label="Time" value={`${hud.elapsed.toFixed(1)}s`} />
        <div className="lives" aria-label={`${hud.lives} of ${maxLives} lives remaining`}>
          {Array.from({ length: maxLives }, (_, i) => (
            <span key={i} className={`life ${i < hud.lives ? 'life--full' : 'life--spent'}`} aria-hidden="true">
              {i < hud.lives ? '●' : '○'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}
