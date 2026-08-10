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
};