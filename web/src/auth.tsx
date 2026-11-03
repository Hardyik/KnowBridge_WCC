import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Profile } from '@knowbridge/shared';
import { api, readToken, writeToken } from './api';

interface AuthState {
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = readToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api<{ profile: Profile }>('/auth/me')
      .then((data) => setProfile(data.profile))
      .catch(() => writeToken(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onSignedOut = () => setProfile(null);
    window.addEventListener('knowbridge:signed-out', onSignedOut);
    return () => window.removeEventListener('knowbridge:signed-out', onSignedOut);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const data = await api<{ token: string; profile: Profile }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    writeToken(data.token);
    setProfile(data.profile);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const data = await api<{ token: string; profile: Profile }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name: displayName }),
    });
    writeToken(data.token);
    setProfile(data.profile);
  }, []);

  const signOut = useCallback(() => {
    writeToken(null);
    setProfile(null);
    window.location.hash = '/';
  }, []);

  const value = useMemo(
    () => ({ profile, loading, signIn, signUp, signOut }),
    [profile, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
