import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId } from "mongodb";
import {
  SessionService,
  SessionPayload,
} from "../../services/auth/sessionService";

// Extend Fastify request type to include session
declare module "fastify" {
  interface FastifyRequest {
    session: SessionPayload | null;
  }
}

export type SessionMiddlewareDeps = {
  sessionService: SessionService;
};

export function registerSessionMiddleware(
  app: FastifyInstance,
  deps: SessionMiddlewareDeps,
): void {
  const { sessionService } = deps;

  // Decorate request with session property
  app.decorateRequest("session", null);

  // Add hook to parse session from cookie or header
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(request);

      if (!token) {
        request.session = null;
        return;
      }

      const session = sessionService.validateSession(token);
      request.session = session;

      // Refresh session cookie on each request (sliding session)
      if (session) {
        refreshSessionCookie(reply, sessionService, session);
      }
    },
  );
}

export function sessionAuthMiddleware(
  app: FastifyInstance,
  sessionService: SessionService,
): void {
  // Decorate request with session property
  app.decorateRequest("session", null);

  // Add hook to parse session from cookie or header
  app.addHook(
    "preHandler",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(request);

      if (!token) {
        request.session = null;
        return;
      }

      const session = sessionService.validateSession(token);
      request.session = session;

      // Refresh session cookie on each request (sliding session)
      if (session) {
        refreshSessionCookie(reply, sessionService, session);
      }
    },
  );
}

function refreshSessionCookie(
  reply: FastifyReply,
  sessionService: SessionService,
  session: SessionPayload,
): void {
  const newToken = sessionService.createSession({
    userId: new ObjectId(session.userId),
    accountId: new ObjectId(session.accountId),
  });

  reply.setCookie("session", newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
}

function extractToken(request: FastifyRequest): string | null {
  // Try cookie first
  const cookieToken = request.cookies?.session;
  if (cookieToken) {
    return cookieToken;
  }

  // Try Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}
