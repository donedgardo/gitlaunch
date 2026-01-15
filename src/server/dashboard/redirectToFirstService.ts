import { ServiceI } from "../../services/service/interface";
import { FastifyReply } from "fastify";

export function redirectToFirstService(
  services: ServiceI[],
  res: FastifyReply,
) {
  let firstServiceName = services.length === 0 ? "" : services[0].getName();
  return res.redirect(`/dashboard/${firstServiceName}`);
}
