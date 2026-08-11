-- Devices Table (For anonymous, zero-login users tracked by browser/device UUID)
CREATE TABLE anonymous_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_uuid VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Users Table (Populated when they use Google OAuth)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Preferences & Settings (Can link to EITHER a user account OR an anonymous device)
CREATE TABLE user_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_uuid VARCHAR(255) REFERENCES anonymous_sessions(device_uuid) ON DELETE CASCADE,
    default_timeframe VARCHAR(10) DEFAULT '1H',
    theme VARCHAR(20) DEFAULT 'dark',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT fk_owner CHECK (user_id IS NOT NULL OR device_uuid IS NOT NULL)
);

-- Saved Watchlists / Pairs
CREATE TABLE user_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    device_uuid VARCHAR(255) REFERENCES anonymous_sessions(device_uuid) ON DELETE CASCADE,
    symbol VARCHAR(20) NOT NULL, -- e.g., 'EURUSD', 'GBPUSD'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_alerts (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    condition VARCHAR(20) NOT NULL, -- 'ABOVE', 'BELOW', 'RSI_OVERSOLD', 'RSI_OVERBOUGHT'
    threshold_value NUMERIC(18, 8) NOT NULL,
    is_triggered BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supported assets for search autocomplete
CREATE TABLE IF NOT EXISTS supported_symbols (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    category VARCHAR(20) NOT NULL, -- 'crypto' or 'forex'
    exchange VARCHAR(50) NOT NULL
);

-- User watchlist
CREATE TABLE IF NOT EXISTS user_watchlist (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    symbol VARCHAR(50) REFERENCES supported_symbols(symbol) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, symbol)
);