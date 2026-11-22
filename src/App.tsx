import React, { useEffect, useState } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import { Landmark } from 'lucide-react';
import { auth, googleProvider } from './firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInView } from './components/SignInView';
import { ClientPortal } from './components/ClientPortal';
import { OfflineIndicator } from './components/PWAInstallButton';

function ClientWorkspace() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('cairn_portal_mode');
    }

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Unable to complete Google sign-in. Please retry.',
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <Landmark className="w-8 h-8 text-emerald-800 mx-auto" />
          <p className="text-sm font-medium text-slate-700">Loading Client App...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <SignInView
        onSignIn={handleSignIn}
        isSigningIn={isSigningIn}
        authError={authError}
      />
    );
  }

  return (
    <>
      <ClientPortal
        user={user}
        defaultCurrency="USD"
        onSignOut={handleSignOut}
      />
      <OfflineIndicator />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ClientWorkspace />
    </ErrorBoundary>
  );
}
