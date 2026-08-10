import { redisClient } from "../config/redis.js";

// Add this temporary snippet anywhere in your app to clear the bad cache key
// await redisClient.del('orion:live:BTCUSDT:1h');
await redisClient.flushall()
console.log("Cache key cleared");


redisClient.quit();
console.log("Redis client quit");
// Or if you want to wipe your entire Redis cache clean:
// await redisClient.flushAll();