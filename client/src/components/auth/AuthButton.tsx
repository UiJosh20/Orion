'use client';

import { useAuthStore } from '@/src/store/useAuthStore';
import { GoogleLogin } from '@react-oauth/google';
import { useState, useCallback } from 'react';
import { X, Smartphone, ShieldCheck, LogOut, Cloud } from 'lucide-react';

interface AuthButtonProps {
  mobile?: boolean;
}

export default function AuthButton({ mobile = false }: AuthButtonProps) {
  const { user, isAuthenticated, isInitializing, loginWithGoogle, logout } = useAuthStore();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Consider authenticated only if the user has a real email (not a @device.local fallback)
  const isGoogleAuth =
    isAuthenticated &&
    Boolean(
      user?.email &&
        !user.email.endsWith('@device.local') &&
        user.email.toLowerCase().endsWith('@gmail.com')
    );

  const avatarSrc =
    user?.avatar_url ||
    `https://api.dicebear.com/7.x/identicon/svg?seed=${user?.id || 'default-trader'}`;

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      setIsModalOpen(false);
    } finally {
      setIsLoggingOut(false);
    }
  }, [logout]);

  if (isInitializing) {
    return (
      <div
        className={`${
          mobile ? 'w-8 h-8' : 'h-9 w-28'
        } bg-slate-200 dark:bg-slate-800 animate-pulse rounded-full`}
      />
    );
  }

  return (
    <>
      {/* Trigger Button inside Header */}
      {mobile ? (
        <button
          onClick={() => setIsModalOpen(true)}
          className="relative group p-0.5 rounded-full hover:ring-2 hover:ring-emerald-500 transition-all focus:outline-none shrink-0"
          title="Account & Sync Settings"
        >
          <img
            src={avatarSrc}
            alt={user?.name || 'User'}
            className="w-8 h-8 rounded-full border-2 border-slate-300 dark:border-slate-700 object-cover"
          />
          {/* Status Indicator Dot */}
          <div
            className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-950 ${
              isGoogleAuth ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
        </button>
      ) : (
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-all font-mono"
        >
          <div className="relative shrink-0">
            <img
              src={avatarSrc}
              alt={user?.name || 'User'}
              className="w-6 h-6 rounded-full border border-slate-300 dark:border-slate-700 object-cover"
            />
            <div
              className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white dark:border-slate-900 ${
                isGoogleAuth ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </div>
          <div className="flex flex-col items-start text-left">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[110px]">
              {isGoogleAuth ? user?.name : 'Anonymous Session'}
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
              {isGoogleAuth ? 'Google Synced' : 'Device UUID'}
            </span>
          </div>
        </button>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="absolute inset-0"
            onClick={() => setIsModalOpen(false)}
          />

          <div className="relative w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-2xl z-10 font-sans text-slate-800 dark:text-slate-100">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {isGoogleAuth ? 'Account & Sync' : 'Device Session'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {isGoogleAuth ? 'Synced via Google' : 'Local Storage Mode'}
                </p>
              </div>
            </div>

            <div className="h-px bg-slate-200 dark:bg-slate-800 my-4" />

            {/* STATE 1: Google Account Linked */}
            {isGoogleAuth ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                  <img
                    src={avatarSrc}
                    alt={user?.name || 'User'}
                    className="w-10 h-10 rounded-full border border-slate-300 dark:border-slate-700 object-cover shrink-0"
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold truncate text-slate-900 dark:text-slate-100">
                      {user?.name}
                    </span>
                    {user?.email && (
                      <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {user.email}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-medium mt-0.5">
                      <ShieldCheck className="w-3 h-3" /> Watchlist & Alerts Synced
                    </span>
                  </div>
                </div>

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Your custom watchlists, active price alerts, and Orion preferences are backed up to your Google Account.
                </p>

                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/20 transition-all disabled:opacity-50"
                >
                  <LogOut className="w-4 h-4" />
                  {isLoggingOut ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
            ) : (
              /* STATE 2: Anonymous Device UUID Session */
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-left space-y-2">
                  <div className="flex items-center gap-2 text-amber-500 text-xs font-bold font-mono uppercase">
                    <Smartphone className="w-4 h-4 shrink-0" />
                    Device UUID Auth
                  </div>
                  <p className="text-xs text-slate-800 dark:text-slate-200 font-semibold leading-relaxed">
                    Want to access Orion on other devices?
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Sign in with Google to preserve your custom watchlists, active price alerts, and trading indicators everywhere.
                  </p>
                </div>

                {/* Google Sign-In Action */}
                <div className="flex justify-center pt-2">
                  <GoogleLogin
                    onSuccess={(response) => {
                      if (response.credential) {
                        loginWithGoogle(response.credential);
                        setIsModalOpen(false);
                      }
                    }}
                    onError={() => console.error('Google Auth Failed')}
                    theme="filled_black"
                    shape="pill"
                    size="large"
                    text="continue_with"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}