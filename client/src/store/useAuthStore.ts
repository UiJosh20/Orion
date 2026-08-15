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

const IS_LOGGED_IN_KEY = 'orion_is_logged_in';

export const useAuthStore = create<AuthState>((set, get) => ({
  deviceUuid: '',
  user: null,
  isAuthenticated: false,
  isInitializing: true,

 initializeSession: async () => {
  set({ isInitializing: true });
  try {
    const deviceUuid = getOrCreateDeviceUuid();
    set({ deviceUuid });

    // 1. Sync device session on backend
    await api.post(ENDPOINTS.SESSION.DEVICE, { deviceUuid });

    // 2. Authenticate device session (Pass deviceUuid in body as well)
    await api.post(ENDPOINTS.AUTH.DEVICE, { deviceUuid });

    // 3. Fetch user profile
    const res = await api.get(ENDPOINTS.AUTH.ME);

    if (res.data?.user) {
      localStorage.setItem(IS_LOGGED_IN_KEY, 'true');
      set({ user: res.data.user, isAuthenticated: true });
      return;
    }

    localStorage.setItem(IS_LOGGED_IN_KEY, 'false');
    set({ user: null, isAuthenticated: false });
  } catch (error: any) {
    localStorage.setItem(IS_LOGGED_IN_KEY, 'false');
    set({ user: null, isAuthenticated: false });
  } finally {
    set({ isInitializing: false });
  }
},

  loginWithGoogle: async (idToken: string) => {
    try {
      const { deviceUuid } = get();
      
      const res = await api.post(
        ENDPOINTS.AUTH.GOOGLE,
        { idToken },
        { headers: { 'X-Device-UUID': deviceUuid } }
      );

      const { user } = res.data;
      localStorage.setItem(IS_LOGGED_IN_KEY, 'true');
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
      // Ignore network errors on logout
    } finally {
      localStorage.setItem(IS_LOGGED_IN_KEY, 'false');
      set({ user: null, isAuthenticated: false });

      // Re-establish guest session
      await get().initializeSession();
    }
  },
}));