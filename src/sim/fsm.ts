/**
 * Screen/mode finite state machine (§5). An explicit transition table makes
 * illegal states unreachable — no `isPlaying`/`isPaused`/`isGameOver` booleans
 * that can disagree with each other.
 */

export type GameFSMState =
  | 'menu'
  | 'levelSelect'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'gameOver'
  | 'results';

export const transitions: Record<GameFSMState, readonly GameFSMState[]> = {
  menu: ['levelSelect'],
  levelSelect: ['loading', 'menu'],
  loading: ['playing'],
  playing: ['paused', 'gameOver'],
  paused: ['playing', 'menu'],
  gameOver: ['results'],
  results: ['menu', 'levelSelect'],
};

export function canTransition(from: GameFSMState, to: GameFSMState): boolean {
  return transitions[from].includes(to);
}

/**
 * Returns the next state, or the current one if the transition is illegal.
 * Illegal transitions are a programming error, not a runtime condition — they
 * throw in development so tests catch them.
 */
export function transition(from: GameFSMState, to: GameFSMState): GameFSMState {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal FSM transition: ${from} -> ${to}`);
  }
  return to;
}

export const ALL_FSM_STATES = Object.keys(transitions) as GameFSMState[];
