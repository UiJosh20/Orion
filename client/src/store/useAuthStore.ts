import { create } from 'zustand';
import { api } from '../libs/api/client';
import { ENDPOINTS } from '../constants/endpoints';
import { getOrCreateDeviceUuid } from '../libs/auth/device';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  created_at?: string;
}

interface AuthState {
  deviceUuid: string;
  user: UserProfile | null;
  isAuthenticated: boolean;
  isInitializing: boolean;

  // Actions
  initializeSession: () => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  deviceUuid: '',
  user: null,
  isAuthenticated: false,
  isInitializing: true,

  initializeSession: async () => {
    try {
      const deviceUuid = getOrCreateDeviceUuid();
      set({ deviceUuid });

      // 1. Register/sync device session in the database
      await api.post(
        ENDPOINTS.SESSION.DEVICE,
        { deviceUuid },
        { headers: { 'x-device-uuid': deviceUuid } }
      );

      // 2. Authenticate device session (Backend sets guest HttpOnly cookie)
      await api.post(
        ENDPOINTS.AUTH.DEVICE,
        {},
        { headers: { 'x-device-uuid': deviceUuid } }
      );

      // 3. Retrieve user status via /auth/me (Cookies auto-sent by browser)
      const res = await api.get(ENDPOINTS.AUTH.ME);
      if (res.data?.user) {
        set({ user: res.data.user, isAuthenticated: true });
        return;
      }

      set({ user: null, isAuthenticated: false });
    } catch (error) {
      console.error('Session initialization failed:', error);
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isInitializing: false });
    }
  },

  loginWithGoogle: async (idToken: string) => {
    try {
      const { deviceUuid } = get();
      // Server validates idToken, sets Google session HttpOnly cookies, and migrates guest data
      const res = await api.post(
        ENDPOINTS.AUTH.GOOGLE,
        { idToken },
        { headers: { 'x-device-uuid': deviceUuid } }
      );

      const { user } = res.data;
      set({ user, isAuthenticated: true });
    } catch (error) {
      console.error('Google login failed:', error);
      throw error;
    }
  },

  logout: async () => {
    try {
      // Calls endpoint where backend clears the HttpOnly auth cookies (Set-Cookie: max-age=0)
      await api.post(ENDPOINTS.AUTH.LOGOUT);
    } catch {
      // Ignore logout API errors
    } finally {
      set({ user: null, isAuthenticated: false });

      // Re-initialize device session so a fresh guest device cookie is re-established immediately
      await get().initializeSession();
    }
  },
}));