import type { FastifyInstance } from "fastify";
import { prisma } from "@ankeny/chaya-prisma-package";
import redisClient from "../lib/upstash-redis";

const createPing = async () => {
  let ping = null;
  let dbError = null;
  let cached = null;
  let redisError = null;

  try {
    ping = await prisma.ping.create({ data: {} });
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  try {
    if (ping) {
      await redisClient.set("ping", JSON.stringify(ping));
      cached = await redisClient.get("ping");
    } else {
      cached = await redisClient.get("ping");
    }
  } catch (err) {
    redisError = err instanceof Error ? err.message : String(err);
  }

  return { ping, dbError, cached, redisError };
};

const getHealthMessage = (dbHealthy: boolean, redisHealthy: boolean): string => {
  if (dbHealthy && redisHealthy) return "Database and Redis are healthy";
  if (!dbHealthy && !redisHealthy) return "Both Database and Redis are unhealthy";
  if (dbHealthy) return "Database is healthy, Redis is unhealthy";
  return "Redis is healthy, Database is unhealthy";
};

async function healthRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    const { ping, dbError, cached, redisError } = await createPing();

    const dbHealthy = !!ping && !dbError;
    const redisHealthy = !!cached && !redisError;

    return {
      database: {
        success: dbHealthy,
        details: dbHealthy ? ping : { error: dbError },
      },
      redis: {
        success: redisHealthy,
        details: redisHealthy ? JSON.parse(cached) : { error: redisError },
      },
      message: getHealthMessage(dbHealthy, redisHealthy),
      timestamp: new Date().toISOString(),
    };
  });
}

export default healthRoutes;
