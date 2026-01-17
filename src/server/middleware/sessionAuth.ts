import { FastifyInstance, FastifyRequest } from "fastify";
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
  app.addHook("preHandler", async (request: FastifyRequest) => {
    const token = extractToken(request);

    if (!token) {
      request.session = null;
      return;
    }

    const session = sessionService.validateSession(token);
    request.session = session;
  });
}

export function sessionAuthMiddleware(
  app: FastifyInstance,
  sessionService: SessionService,
): void {
  // Decorate request with session property
  app.decorateRequest("session", null);

  // Add hook to parse session from cookie or header
  app.addHook("preHandler", async (request: FastifyRequest) => {
    const token = extractToken(request);

    if (!token) {
      request.session = null;
      return;
    }

    const session = sessionService.validateSession(token);
    request.session = session;
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
