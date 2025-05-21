import Redis from 'ioredis';

const redisUrl = process.env.UPSTASH_REDIS_URL;

if (!redisUrl) {
  throw new Error('UPSTASH_REDIS_URL is not set');
}

const redisClient = new Redis(redisUrl);

export default redisClient;
