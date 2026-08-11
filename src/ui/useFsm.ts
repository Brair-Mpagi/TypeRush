import { useCallback, useState } from 'react';
import { canTransition, transition, type GameFSMState } from '../sim/fsm';

/**
 * Screen state driven by the FSM table (§5) rather than by booleans. `go`
 * throws on an illegal transition, so a wrong button wiring fails loudly in
 * development instead of producing an impossible screen.
 */
export function useFsm(initial: GameFSMState = 'menu') {
  const [screen, setScreen] = useState<GameFSMState>(initial);

  const go = useCallback((to: GameFSMState) => {
    setScreen((from) => (from === to ? from : transition(from, to)));
  }, []);

  const can = useCallback((to: GameFSMState) => canTransition(screen, to), [screen]);

  return { screen, go, can };
}
