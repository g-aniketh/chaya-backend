import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import farmerRoutes from './routes/farmer.js';
import fieldRoutes from './routes/fields.js';
import procurementRoutes from './routes/procurement.js';
import processingBatchRoutes from './routes/processingBatch.js';
import processingStageRoutes from './routes/processingStage.js';
import salesRoutes from './routes/sales.js';
import healthRoute from './routes/health.js';

console.log('---- Backend Server Starting ----');
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`FRONTEND_URL (from env): ${process.env.FRONTEND_URL}`);
console.log(`JWT_SECRET is set: ${!!process.env.JWT_SECRET}`);
console.log(`COOKIE_SECRET is set: ${!!process.env.COOKIE_SECRET}`);
console.log('---------------------------------');

const fastify = Fastify({
  logger: {
    level: 'debug',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function registerPlugins() {
  const deployedFrontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins: string[] = [];

  if (deployedFrontendUrl) {
    allowedOrigins.push(deployedFrontendUrl);
    fastify.log.info(`CORS: Added deployed frontend URL to allowed origins: ${deployedFrontendUrl}`);
  } else {
    fastify.log.warn('CORS: FRONTEND_URL environment variable is not set. Deployed frontend might not work.');
  }

  const localFrontendUrl = 'http://localhost:3000';
  if (!allowedOrigins.includes(localFrontendUrl)) {
    allowedOrigins.push(localFrontendUrl);
  }
  fastify.log.info(`CORS: Final list of allowed origins: [${allowedOrigins.join(', ')}]`);

  // @ts-ignore - CORS origin function type mismatch is known to work correctly
  await fastify.register(cors, {
    origin: (origin: string | undefined, callback: (err: Error | null, allowOrOrigin?: boolean | string) => void) => {
      if (!origin) {
        return callback(null, false);
      }

      if (allowedOrigins.includes(origin)) {
        fastify.log.debug(`CORS: Allowing origin '${origin}'.`);
        return callback(null, origin);
      } else {
        fastify.log.error(`CORS Error: Origin '${origin}' NOT IN ALLOWED LIST [${allowedOrigins.join(', ')}].`);
        return callback(new Error(`Not allowed by CORS: Origin ${origin} is not permitted.`), false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });
  fastify.log.info('CORS plugin registered with custom origin logic.');

  if (!process.env.JWT_SECRET) {
    fastify.log.fatal('JWT_SECRET environment variable is required! Exiting.');
    throw new Error('JWT_SECRET environment variable is required');
  }

  await fastify.register(jwt, {
    secret: process.env.JWT_SECRET,
  });
  fastify.log.info('JWT plugin registered.');

  if (!process.env.COOKIE_SECRET) {
    fastify.log.warn('COOKIE_SECRET environment variable is not set. Signed cookies will not be secure.');
  }
  await fastify.register(cookie, {
    secret: process.env.COOKIE_SECRET,
    hook: 'onRequest',
  });
  fastify.log.info('Cookie plugin registered.');
}

async function registerRoutes() {
  fastify.register(authRoutes, { prefix: '/api/auth' });
  fastify.register(userRoutes, { prefix: '/api/users' });
  fastify.register(farmerRoutes, { prefix: '/api/farmers' });
  fastify.register(fieldRoutes, { prefix: '/api/fields' });
  fastify.register(procurementRoutes, { prefix: '/api/procurements' });
  fastify.register(processingBatchRoutes, {
    prefix: '/api/processing-batches',
  });
  fastify.register(processingStageRoutes, {
    prefix: '/api/processing-stages',
  });
  fastify.register(salesRoutes, { prefix: '/api/sales' });
  fastify.register(healthRoute, { prefix: '/api/health' });
  fastify.log.info('All application routes registered.');
}

async function start() {
  try {
    console.log('---- Backend Server Starting ----');
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`FRONTEND_URL (from env): ${process.env.FRONTEND_URL}`);
    console.log(`JWT_SECRET is set: ${!!process.env.JWT_SECRET}`);
    console.log(`COOKIE_SECRET is set: ${!!process.env.COOKIE_SECRET}`);
    console.log('---------------------------------');

    await registerPlugins();
    await registerRoutes();

    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
    const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost';

    fastify.log.info(`Attempting to listen on ${host}:${port}`);
    await fastify.listen({ port, host });
  } catch (err) {
    fastify.log.fatal({ err }, 'Server startup failed');
    process.exit(1);
  }
}

start();
