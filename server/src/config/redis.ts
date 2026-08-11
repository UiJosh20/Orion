import { Redis } from 'ioredis';
import dotenv from 'dotenv';
import { ENV } from './env.js';

dotenv.config();

const redisUrl = ENV.REDIS_URL || 'redis://localhost:6379';

// Main client for GET, SET, and general operations
export const redisClient = new Redis(redisUrl, {
  enableReadyCheck: false,
});

// Dedicated client for Redis Pub/Sub subscriptions
export const redisSubClient = redisClient.duplicate();

redisClient.on('connect', () => {
  console.log('[Redis]: Successfully connected to main Redis instance.');
});

redisClient.on('error', (redisError) => {
  console.error('[Redis Connection Error]:', redisError);
});

redisSubClient.on('connect', () => {
  console.log('[Redis]: Successfully connected to Pub/Sub subscriber instance.');
});

redisSubClient.on('error', (redisError) => {
  console.error('[Redis Subscriber Error]:', redisError);
});