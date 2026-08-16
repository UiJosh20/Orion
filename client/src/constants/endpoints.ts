export const ENDPOINTS = {
  ROOT: '/',
  SESSION: {
    DEVICE: '/session/device',
  },
  AUTH: {
    GOOGLE: '/auth/google',
    DEVICE: '/auth/device',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
  },
  MARKET: {
    SYMBOLS: '/market/symbols',
    ANALYZE: '/market/analyze',
    // ✅ NEW POSITIONS ENDPOINTS
    POSITIONS: '/market/positions',
    RISK_CONFIG: '/market/risk-config',
  },
  WATCHLIST: {
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