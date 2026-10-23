import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import type { SessionState } from '@/data';
import { data } from '@/data/app';

const SessionContext = createContext<SessionState>({ status: 'loading' });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  useEffect(() => data.onSessionChange(setSession), []);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
