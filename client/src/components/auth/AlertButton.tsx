'use client';

import { useAuthStore } from '@/src/store/useAuthStore';
import { GoogleLogin } from '@react-oauth/google';

export default function AuthButton() {
  const { user, isAuthenticated, isInitializing, loginWithGoogle, logout } = useAuthStore();

  if (isInitializing) {
    return <div className="h-9 w-24 bg-slate-800 animate-pulse rounded-full" />;
  }

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-3">
        <img
          src={user.avatar_url || '/default-avatar.png'}
          alt={user.name}
          className="w-8 h-8 rounded-full border border-slate-700"
        />
        <span className="text-sm font-medium text-slate-200 hidden sm:inline">
          {user.name}
        </span>
        <button
          onClick={logout}
          className="text-xs px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
        >
          Sign Out
        </button>
      </div>
    );
  }

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
      size="medium"
    />
  );
}