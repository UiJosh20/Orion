export const ENDPOINTS = {
    
  ROOT: '/',
  SESSION: {
    // Registers or pings anonymous device sessions
    DEVICE: '/session/device',
  },
  AUTH: {
    // Google OAuth exchange & session management
    GOOGLE: '/auth/google',
    // Device session authentication
    DEVICE: '/auth/device',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
  },
  MARKET: {
    SYMBOLS: '/market/symbols',
    ANALYZE: '/market/analyze',
  },
  WATCHLIST: {
    // Dynamic getter for device_uuid OR user_id watchlists
    GET: (userId: string) => `/market/watchlist/${encodeURIComponent(userId)}`,
    ADD: '/market/watchlist',
    REMOVE: (userId: string, symbol: string) =>
      `/market/watchlist/${encodeURIComponent(userId)}/${encodeURIComponent(symbol)}`,
  },
  ALERTS: {
    BASE: '/alerts/create',
    ACTIVE: '/alerts/active',
    DELETE: (id: string | number) => `/alerts/${id}`,
    TOGGLE: (id: string | number) => `/alerts/${id}/toggle`,
  },
  AI: {
    INSIGHT: '/ai/insight',
  },
} as const;