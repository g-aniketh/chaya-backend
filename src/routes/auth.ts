import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  prisma,
  loginSchema,
  registerSchema,
} from "@ankeny/chaya-prisma-package";
import {
  authenticate,
  verifyAdmin,
  type AuthenticatedRequest,
  type JWTPayload,
} from "../middlewares/auth.js";
import redisClient from "../lib/upstash-redis.js";
async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/login", async (request, reply) => {
    try {
      const { email, password } = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({
        where: { email },
      });
      if (!user) {
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      if (!user.isEnabled) {
        return reply.status(403).send({
          error:
            "Your account has been disabled. Please contact an administrator.",
        });
      }

      const isPasswordValid = await verifyPassword(password, user.password);
      if (!isPasswordValid) {
        return reply.status(401).send({ error: "Invalid email or password" });
      }

      const token = fastify.jwt.sign(
        {
          id: user.id,
          role: user.role,
        } as Omit<JWTPayload, "iat" | "exp">,
        {
          expiresIn: "7d",
        },
      );

      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          isActive: true,
        },
      });
      console.log(`Current NODE_ENV during /login: ${process.env.NODE_ENV}`);
      reply.setCookie("token", token, {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });
      const cacheKey = `users:all`;
      await redisClient.del(cacheKey);
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
        token: token,
      };
    } catch (error) {
      console.error("Login error:", error);
      return reply.status(400).send({ error: "Invalid request" });
    }
  });

  fastify.post("/logout", async (request, reply) => {
    try {
      let tokenToInvalidate = request.cookies.token;

      if (!tokenToInvalidate) {
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          tokenToInvalidate = authHeader.substring(7);
          request.log.info("Logout: Using token from Authorization header.");
        }
      }

      if (tokenToInvalidate) {
        try {
          const decoded =
            request.server.jwt.verify<JWTPayload>(tokenToInvalidate);
          await prisma.user.update({
            where: { id: decoded.id },
            data: { isActive: false },
          });
          request.log.info(`Logout: User ${decoded.id} marked as inactive.`);
        } catch (error) {
          request.log.warn(
            { err: error },
            "Logout: Token verification error or user update failed.",
          );
        }
      } else {
        request.log.info(
          "Logout: No token provided in cookie or Authorization header.",
        );
      }

      reply.clearCookie("token", {
        path: "/",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      });

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ err: error }, "Logout error");
      return reply.status(500).send({ error: "Server error during logout" });
    }
  });

  fastify.post(
    "/register",
    { preHandler: [verifyAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const userData = registerSchema.parse(request.body);

        const existingUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });

        if (existingUser) {
          return reply.status(400).send({ error: "Email already in use" });
        }

        const hashedPassword = await hashPassword(userData.password);

        const newUser = await prisma.user.create({
          data: {
            name: userData.name,
            email: userData.email,
            password: hashedPassword,
            role: userData.role,
          },
        });

        return {
          user: {
            id: newUser.id,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
          },
        };
      } catch (error) {
        console.error("Registration error:", error);
        return reply.status(400).send({ error: "Invalid request" });
      }
    },
  );

  fastify.get(
    "/me",
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authRequest = request as AuthenticatedRequest;
      console.log(authRequest);
      try {
        const user = await prisma.user.findUnique({
          where: { id: authRequest.user.id },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isEnabled: true,
          },
        });

        if (!user?.isEnabled) {
          reply.clearCookie("token", {
            path: "/",
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
          });
          return reply
            .status(401)
            .send({ error: "User not found or disabled" });
        }

        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        };
      } catch (error) {
        console.error("Get user error:", error);
        return reply.status(500).send({ error: "Server error" });
      }
    },
  );
}

export default authRoutes;
