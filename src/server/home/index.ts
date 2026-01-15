import { FastifyInstance } from "fastify";
import { ServiceI } from "../../services/service/interface";
import { redirectToFirstService } from "../dashboard";

export default function (services: ServiceI[] = []) {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.get("/", (req, res) => {
      if (!req.user) {
        return res.view(
          "index.hbs",
          {},
          {
            layout: "/layouts/main.hbs",
          },
        );
      } else {
        return redirectToFirstService(services, res);
      }
    });
    done();
  };
}
