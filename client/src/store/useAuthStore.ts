import { create } from 'zustand';
import { api } from '../libs/api/client';
import { ENDPOINTS } from '../constants/endpoints';
import { getOrCreateDeviceUuid } from '../libs/auth/device';

interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
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

      // 2. Authenticate the device session to receive access & refresh tokens
      const deviceAuthRes = await api.post(
        ENDPOINTS.AUTH.DEVICE, 
        {},
        { headers: { 'x-device-uuid': deviceUuid } }
      );

      if (deviceAuthRes.data?.accessToken) {
        localStorage.setItem('access_token', deviceAuthRes.data.accessToken);
      }

      // 3. Verify user/session status via /auth/me
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const res = await api.get(ENDPOINTS.AUTH.ME);
          if (res.data?.user) {
            set({ user: res.data.user, isAuthenticated: true });
            return;
          }
        } catch {
          // Fallback if token points to a guest device rather than a Google user
        }
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
      // Pass deviceUuid so backend migrates guest watchlists/alerts to the Google user
      const res = await api.post(ENDPOINTS.AUTH.GOOGLE, { idToken }, {
        headers: { 'x-device-uuid': deviceUuid }
      });
      const { user, accessToken } = res.data;

      localStorage.setItem('access_token', accessToken);
      set({ user, isAuthenticated: true });
    } catch (error) {
      console.error('Google login failed:', error);
      throw error;
    }
  },

  logout: async () => {
    try {
      await api.post(ENDPOINTS.AUTH.LOGOUT);
    } catch {
      // Ignore logout errors
    } finally {
      localStorage.removeItem('access_token');
      set({ user: null, isAuthenticated: false });

      // Re-initialize device session so guest token is re-established immediately
      await get().initializeSession();
    }
  },
}));