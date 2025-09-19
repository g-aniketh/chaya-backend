import type { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "@ankeny/chaya-prisma-package";

export interface JWTPayload {
  id: number;
  role: "ADMIN" | "STAFF";
  iat: number;
  exp: number;
}

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    let token = request.cookies.token;

    if (!token) {
      const authHeader = request.headers.authorization;
      //request.log.info('Authorization header:', request.headers.authorization);
      if (authHeader) {
        if (authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
          request.log.info(
            "Token found in Authorization header for /api/auth/me",
          );
        }
      }
    }

    if (!token) {
      request.log.warn(
        "No token found in cookies or Authorization header for /api/auth/me",
      );
      return reply.status(401).send({ error: "Authentication required" });
    }

    const decoded = request.server.jwt.verify<JWTPayload>(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id, isEnabled: true },
    });

    if (!user) {
      request.log.warn(
        `User ID ${decoded.id} not found or disabled for /api/auth/me (token verified)`,
      );
      return reply.status(401).send({ error: "User not found or disabled" });
    }
    (request as any).user = decoded;
  } catch (error) {
    request.log.error({ err: error }, "Authentication error in /api/auth/me");
    return reply.status(401).send({ error: "Invalid or expired token" });
  }
}

export async function verifyAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const isAuthenticated = await authenticate(request, reply);
  if (!isAuthenticated) return false;

  const user = (request as any).user as JWTPayload;
  if (!user || user.role !== "ADMIN") {
    console.log("User is not an admin. Role:", user?.role);
    reply.status(403).send({ error: "Admin access required" });
    return false;
  }
  return true;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: JWTPayload;
}
