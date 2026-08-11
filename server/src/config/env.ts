import dotenv from 'dotenv';
dotenv.config();

 if(!process.env.DATABASE_URL){
    throw new Error('DATABASE_URL environment variable is not set')
 }

export const ENV = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || '',
  TWELVE_DATA_API_KEY: process.env.TWELVE_DATA_API_KEY || '',
  REDIS_URL: process.env.REDIS_URL || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  TIINGO_API_KEY: process.env.TIINGO_API_KEY || '',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || '',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || '',
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRY || '1h',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRY || '7d',
};