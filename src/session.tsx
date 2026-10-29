import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { SessionState, UserId } from '@/data';
import { data } from '@/data/app';

const SessionContext = createContext<SessionState>({ status: 'loading' });

/**
 * Whether the signed-in user may use the app yet (decisions 11): `needed` until they choose a
 * username, `chosen` after. `checking` while the app finds out, and while no one is signed in.
 */
export type UsernameGate = 'checking' | 'needed' | 'chosen';

const UsernameContext = createContext<{ gate: UsernameGate; chosen: () => void }>({
  gate: 'checking',
  chosen: () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  useEffect(() => data.onSessionChange(setSession), []);

  // The gate is per user: someone else signing in is checked afresh.
  const userId = session.status === 'signedIn' ? session.userId : null;
  const [checked, setChecked] = useState<{ userId: UserId; gate: UsernameGate } | null>(null);
  useEffect(() => {
    if (userId === null) return;
    let live = true;
    void data.needsUsername().then((needed) => {
      if (live) setChecked({ userId, gate: needed ? 'needed' : 'chosen' });
    });
    return () => {
      live = false;
    };
  }, [userId]);
  const gate = userId !== null && checked?.userId === userId ? checked.gate : 'checking';
  const chosen = () => {
    if (userId !== null) setChecked({ userId, gate: 'chosen' });
  };

  return (
    <SessionContext.Provider value={session}>
      <UsernameContext.Provider value={{ gate, chosen }}>{children}</UsernameContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/** The signed-in user's username gate, and `chosen()` for the screen that sets one. */
export function useUsernameGate() {
  return useContext(UsernameContext);
}
