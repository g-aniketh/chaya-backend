import type { FastifyInstance } from "fastify";
import { prisma, updateUserSchema } from "@ankeny/chaya-prisma-package";
import { verifyAdmin, type AuthenticatedRequest } from "../middlewares/auth";
import { hashPassword } from "../lib/password";
import redisClient from "../lib/upstash-redis";

async function userRoutes(fastify: FastifyInstance) {
  fastify.get("/", { preHandler: verifyAdmin }, async (request, reply) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isEnabled: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      });
      return { users };
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    }
  });

  fastify.get("/:id", { preHandler: verifyAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const cacheKey = `users:${id}`;
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return { user: JSON.parse(cached) };
      }
      const user = await prisma.user.findUnique({
        where: { id: parseInt(id) },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isEnabled: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      if (!user) {
        return reply.status(404).send({ error: "User not found" });
      }
      await redisClient.set(cacheKey, JSON.stringify(user), "EX", 3600);
      return { user };
    } catch (error) {
      console.error('Error fetching user:', error);
      throw error;
    }
  });

  fastify.put("/:id", { preHandler: verifyAdmin }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const userData = updateUserSchema.parse(request.body);
      const existingUser = await prisma.user.findUnique({
        where: { id: parseInt(id) },
      });
      if (!existingUser) {
        return reply.status(404).send({ error: "User not found" });
      }
      const updateData: any = {};
      if (userData.name) updateData.name = userData.name;
      if (userData.email) updateData.email = userData.email;
      if (userData.isEnabled !== undefined)
        updateData.isEnabled = userData.isEnabled;
      if (userData.password) {
        updateData.password = await hashPassword(userData.password);
      }
      const updatedUser = await prisma.user.update({
        where: { id: parseInt(id) },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isEnabled: true,
          isActive: true,
          lastLoginAt: true,
          updatedAt: true,
        },
      });
      await redisClient.del(`users:${id}`);
      await redisClient.del("users:all");
      return { user: updatedUser };
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  });

  fastify.patch(
    "/:id/toggle-status",
    { preHandler: verifyAdmin },
    async (request, reply) => {
      const authRequest = request as AuthenticatedRequest;
      try {
        const { id } = authRequest.params as { id: string };
        const user = await prisma.user.findUnique({
          where: { id: parseInt(id) },
        });
        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }
        const updatedUser = await prisma.user.update({
          where: { id: parseInt(id) },
          data: { isEnabled: !user.isEnabled },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isEnabled: true,
          },
        });
        await redisClient.del(`users:${id}`);
        await redisClient.del("users:all");
        return { user: updatedUser };
      } catch (error) {
        console.error('Error toggling user status:', error);
        throw error;
      }
    },
  );

  fastify.delete(
    "/:id",
    { preHandler: verifyAdmin },
    async (request, reply) => {
      try {
        const { id } = request.params as { id: string };
        const user = await prisma.user.findUnique({
          where: { id: parseInt(id) },
        });
        if (!user) {
          return reply.status(404).send({ error: "User not found" });
        }
        if (user.role === "ADMIN") {
          return reply.status(403).send({ error: "Cannot delete admin users" });
        }
        await prisma.user.delete({
          where: { id: parseInt(id) },
        });
        await redisClient.del(`users:${id}`);
        await redisClient.del("users:all");
        return { success: true };
      } catch (error) {
        console.error('Error deleting user:', error);
        throw error;
      }
    },
  );
}

export default userRoutes;
