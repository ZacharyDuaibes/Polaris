import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Profile } from '@/types/database';
import { getProfileById, signIn, signUp, type AuthUser } from '@/db/api';
import { toast } from 'sonner';

interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

interface StoredSession {
  user: AuthUser;
  profile: Profile;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const SESSION_KEY = 'polaris.auth.session';

const readSession = (): StoredSession | null => {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.user?.id || !parsed?.profile?.id) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeSession = (session: StoredSession | null) => {
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSession();
    if (session) {
      setUser(session.user);
      setProfile(session.profile);
    }
    setLoading(false);
  }, []);

  const applySession = (session: StoredSession) => {
    writeSession(session);
    setUser(session.user);
    setProfile(session.profile);
  };

  const login = async (username: string, password: string) => {
    const session = await signIn(username, password);
    applySession(session);
  };

  const signup = async (username: string, password: string) => {
    const session = await signUp(username, password);
    applySession(session);
  };

  const signOut = async () => {
    writeSession(null);
    setUser(null);
    setProfile(null);
  };

  const refreshProfile = async () => {
    const session = readSession();
    if (!session) {
      setUser(null);
      setProfile(null);
      return;
    }

    try {
      const profileData = await getProfileById(session.user.id);
      if (profileData) {
        const next = { user: session.user, profile: profileData };
        applySession(next);
      }
    } catch (error) {
      toast.error('Failed to refresh profile');
      console.error(error);
    }
  };

  const contextValue = useMemo(
    () => ({
      user,
      profile,
      loading,
      login,
      signup,
      signOut,
      refreshProfile,
    }),
    [user, profile, loading]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
