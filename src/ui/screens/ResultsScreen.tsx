import type { SessionSummary } from '../../app/engine';
import type { ProgressRow, SessionRow } from '../../persistence/schema';
import { keyErrorRate } from '../../sim/metrics';
import type { Records } from '../useProfile';

interface Props {
  summary: SessionSummary;
  records: Records;
  history: SessionRow[];
  progress: ProgressRow;
  onPlayAgain: () => void;
  onMenu: () => void;
}

const MODE_LABELS: Record<SessionRow['mode'], string> = {
  learning: 'Learning',
  arcade: 'Arcade',
  speedTest: 'Speed test',
  accuracy: 'Accuracy',
  survival: 'Survival',
};

export function ResultsScreen({ summary, records, history, progress, onPlayAgain, onMenu }: Props) {
  const { metrics } = summary;
  const durationSec = metrics.durationMs / 1000;
  // The run just saved is the newest row; show the ones before it as context.
  const earlier = history.slice(1, 6);

  return (
    <div className="screen results">
      <h2 className="heading">Session complete</h2>

      <div className="results__score">
        <span className="results__score-value">{summary.score.toLocaleString()}</span>
        <span className="results__score-label">points</span>
        {records.score && <span className="badge">New high score</span>}
      </div>

      <dl className="results__grid">
        <Metric label="WPM" value={metrics.wpm.toFixed(1)} hint={`${metrics.rawWpm.toFixed(1)} raw`} best={records.wpm} />
        <Metric
          label="Accuracy"
          value={`${(metrics.accuracy * 100).toFixed(1)}%`}
          hint={`${metrics.errors} errors`}
          best={records.accuracy}
        />
        <Metric label="Consistency" value={`${(metrics.consistency * 100).toFixed(0)}%`} hint="rhythm steadiness" />
        <Metric
          label="Best combo"
          value={String(summary.bestCombo)}
          hint={`×${Math.min(1 + Math.floor(summary.bestCombo / 10), 5)} peak`}
        />
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
                    {Math.round(rate * 100)}% missed{' '}
                    <span className="hint">
                      ({stat.errors}/{stat.attempts})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="hint">Upcoming words will lean toward these keys.</p>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="history">
          <h3>Recent sessions</h3>
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Mode</th>
                <th scope="col">WPM</th>
                <th scope="col">Accuracy</th>
                <th scope="col">Score</th>
              </tr>
            </thead>
            <tbody>
              {earlier.map((row) => (
                <tr key={row.id}>
                  <td>{formatWhen(row.createdAt)}</td>
                  <td>{MODE_LABELS[row.mode]}</td>
                  <td>{row.wpm.toFixed(0)}</td>
                  <td>{(row.accuracy * 100).toFixed(0)}%</td>
                  <td>{row.score.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">
            {progress.sessionsPlayed} sessions · {progress.xp.toLocaleString()} XP · level{' '}
            {progress.highestLevelUnlocked} unlocked
          </p>
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

function Metric({ label, value, hint, best }: { label: string; value: string; hint?: string; best?: boolean }) {
  return (
    <div className={`metric ${best ? 'metric--best' : ''}`}>
      <dt>
        {label}
        {best && <span className="badge badge--small">best</span>}
      </dt>
      <dd>
        {value}
        {hint && <span className="hint"> {hint}</span>}
      </dd>
    </div>
  );
}

function formatWhen(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}
