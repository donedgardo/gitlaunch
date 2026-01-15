import { UserRecord } from "../../src/userService/userRecord";
declare module "fastify" {
  export interface FastifyRequest {
    user?: UserRecord;
    isApiKeyValid?: boolean;
  }
}
