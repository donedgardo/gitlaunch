import { OAuthServiceI } from "../../services/auth/interface";
import { FastifyInstance, FastifyRequest } from "fastify";

interface QueryParamsI {
  code: string;
}

export default function (authService: OAuthServiceI) {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.get<{ Querystring: QueryParamsI }>(
      "/login/google/callback",
      async (req, res) => {
        try {
          const token = await authService.getOAuthToken(req?.query?.code);
          res
            .setCookie("authToken", token?.access_token, {
              signed: true,
              path: "/",
            })
            .redirect("/");
        } catch (e) {
          res.send("Error Authenticating");
        }
      },
    );
    server.get("/logout", async (req, res) => {
      res.clearCookie("authToken", { path: "/" }).redirect("/");
    });
    done();
  };
}

export function userAuthDecorator(
  server: FastifyInstance,
  authService: OAuthServiceI,
) {
  server.decorateRequest("user", null);
  server.addHook("preParsing", async (request) => {
    const authToken = getAuthToken(request);
    const apiKey = request.headers["x-api-key"] as string;
    request.isApiKeyValid = authService.isApiTokenValid(apiKey);
    if (!authToken) return;
    const user = await authService.getUser(authToken);
    if (!user) return;
    request.user = user;
  });
}

function getAuthToken(request: FastifyRequest) {
  const authTokenCookie = request?.cookies?.authToken;
  if (authTokenCookie) return authTokenCookie;
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.split(" ")[1];
}
