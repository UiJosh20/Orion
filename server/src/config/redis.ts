import {Redis} from 'ioredis';
import dotenv from 'dotenv';
import { ENV } from './env.js';

dotenv.config();

const redisUrl = ENV.REDIS_URL || 'redis://localhost:6379';

export const redisClient = new Redis(redisUrl, {
  enableReadyCheck: false,
});

redisClient.on('connect', () => {
  console.log('[Redis]: Successfully connected to Redis instance.');
});

redisClient.on('error', (redisError) => {
  console.error('[Redis Connection Error]:', redisError);
});