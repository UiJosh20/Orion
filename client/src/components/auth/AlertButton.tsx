'use client';

import { useAuthStore } from '@/src/store/useAuthStore';
import { GoogleLogin } from '@react-oauth/google';
import { useState, useCallback } from 'react';

interface AuthButtonProps {
  mobile?: boolean;
}

export default function AuthButton({ mobile = false }: AuthButtonProps) {
  const { user, isAuthenticated, isInitializing, loginWithGoogle, logout } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout]);

  if (isInitializing) {
    return (
      <div className={`${mobile ? 'w-8 h-8' : 'h-9 w-24'} bg-slate-200 dark:bg-slate-800 animate-pulse rounded-full`} />
    );
  }

  if (isAuthenticated && user) {
    // Mobile version - just avatar
    if (mobile) {
      return (
        <div className="relative group">
          <img
            src={user.avatar_url || '/default-avatar.png'}
            alt={user.name || 'User'}
            className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-slate-700 object-cover cursor-pointer transition-all hover:border-emerald-500"
            onClick={handleLogout}
            title="Tap to sign out"
          />
          <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-950" />
        </div>
      );
    }

    // Desktop version - full profile
    return (
      <div className="flex items-center gap-2 sm:gap-3 bg-slate-100 dark:bg-slate-900 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-all hover:border-slate-300 dark:hover:border-slate-700">
        <div className="relative">
          <img
            src={user.avatar_url || '/default-avatar.png'}
            alt={user.name || 'User'}
            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full border border-slate-300 dark:border-slate-700 object-cover"
          />
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white dark:border-slate-900" />
        </div>
        <span className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[100px] sm:max-w-[150px]">
          {user.name}
        </span>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="text-[10px] sm:text-xs px-2 sm:px-3 py-1 rounded bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoggingOut ? '...' : 'Sign Out'}
        </button>
      </div>
    );
  }

  // Not authenticated - show Google Login
  if (mobile) {
    // Mobile: Smaller, more compact Google Login
    return (
      <div className="scale-90 origin-right">
        <GoogleLogin
          onSuccess={(response) => {
            if (response.credential) {
              loginWithGoogle(response.credential);
            }
          }}
          onError={() => console.error('Google Auth Failed')}
          theme="filled_black"
          shape="pill"
          size="medium"
          text="signin_with"
          width="160"
        />
      </div>
    );
  }

  // Desktop: Full Google Login
  return (
    <GoogleLogin
      onSuccess={(response) => {
        if (response.credential) {
          loginWithGoogle(response.credential);
        }
      }}
      onError={() => console.error('Google Auth Failed')}
      theme="filled_black"
      shape="pill"
      size="large"
      text="signin_with"
    />
  );
}