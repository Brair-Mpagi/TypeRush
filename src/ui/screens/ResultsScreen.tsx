import type { SessionSummary } from '../../app/engine';
import { keyErrorRate } from '../../sim/metrics';

interface Props {
  summary: SessionSummary;
  onPlayAgain: () => void;
  onMenu: () => void;
}

export function ResultsScreen({ summary, onPlayAgain, onMenu }: Props) {
  const { metrics } = summary;
  const durationSec = metrics.durationMs / 1000;

  return (
    <div className="screen results">
      <h2 className="heading">Session complete</h2>

      <div className="results__score">
        <span className="results__score-value">{summary.score.toLocaleString()}</span>
        <span className="results__score-label">points</span>
      </div>

      <dl className="results__grid">
        <Metric label="WPM" value={metrics.wpm.toFixed(1)} hint={`${metrics.rawWpm.toFixed(1)} raw`} />
        <Metric label="Accuracy" value={`${(metrics.accuracy * 100).toFixed(1)}%`} hint={`${metrics.errors} errors`} />
        <Metric label="Consistency" value={`${(metrics.consistency * 100).toFixed(0)}%`} hint="rhythm steadiness" />
        <Metric label="Best combo" value={String(summary.bestCombo)} hint={`×${Math.min(1 + Math.floor(summary.bestCombo / 10), 5)} peak`} />
        <Metric label="Words" value={String(summary.wordsCompleted)} hint={`${summary.wordsMissed} missed`} />
        <Metric label="Time" value={`${durationSec.toFixed(1)}s`} hint={`level ${summary.level}`} />
      </dl>

      {summary.weakKeys.length > 0 && (
        <section className="weak-keys">
          <h3>Keys to work on</h3>
          <ul>
            {summary.weakKeys.map((stat) => {
              const rate = keyErrorRate(stat);
              return (
                <li key={stat.char}>
                  <span className="weak-keys__char">{stat.char === ' ' ? '␣' : stat.char}</span>
                  <span className="weak-keys__bar" aria-hidden="true">
                    <span className="weak-keys__fill" style={{ width: `${Math.round(rate * 100)}%` }} />
                  </span>
                  {/* The number carries the meaning, not the bar colour (§14). */}
                  <span className="weak-keys__rate">
                    {Math.round(rate * 100)}% missed <span className="hint">({stat.errors}/{stat.attempts})</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">Upcoming words will lean toward these keys.</p>
        </section>
      )}

      <div className="row">
        <button type="button" className="button button--primary" onClick={onPlayAgain} autoFocus>
          Play again
        </button>
        <button type="button" className="button" onClick={onMenu}>
          Menu
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        {value}
        {hint && <span className="hint"> {hint}</span>}
      </dd>
    </div>
  );
}
