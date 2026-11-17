import React, { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { LogIn, UserPlus } from 'lucide-react';

const DEMO_ACCOUNTS = [
  { username: 'admin', role: 'Admin' },
  { username: 'provider', role: 'Provider' },
  { username: 'operator', role: 'Operator' },
] as const;

const LoginPage: React.FC = () => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [username, setUsername] = useState('operator');
  const [password, setPassword] = useState('demo');
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const { user, loading, login, signup } = useAuth();
  const returnTo = (location.state as { from?: string } | null)?.from || '/';

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      toast.error('Username and password are required');
      return;
    }

    try {
      setSubmitting(true);
      if (mode === 'login') {
        await login(trimmedUsername, password);
      } else {
        await signup(trimmedUsername, password);
      }
      toast.success(mode === 'login' ? 'Signed in' : 'Account created');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Authentication failed';
      toast.error(message);
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !submitting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!loading && user) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <img src="https://i.postimg.cc/wBJsqfhs/polaris-logo.png" alt="Polaris Logo" className="h-12 w-18" />
          </div>
          <CardTitle>{mode === 'login' ? 'Local demo login' : 'Create local account'}</CardTitle>
          <CardDescription>
            No Auth0 or cloud APIs required. Use a seeded demo account or create a new local user.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={submitting}>
              {mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {submitting ? 'Working...' : mode === 'login' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={submitting}
            onClick={() => setMode((current) => (current === 'login' ? 'signup' : 'login'))}
          >
            {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
          </Button>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">Demo accounts (password: demo)</p>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.username}>
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => {
                      setMode('login');
                      setUsername(account.username);
                      setPassword('demo');
                    }}
                  >
                    {account.username}
                  </button>
                  {' — '}
                  {account.role}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;
