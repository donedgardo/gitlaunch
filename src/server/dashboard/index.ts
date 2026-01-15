import * as Handlebars from "handlebars";
import { FastifyInstance } from "fastify";
import { ServiceI } from "../../services/service/interface";
import { redirectToFirstService } from "./redirectToFirstService";

export default function (services: ServiceI[]) {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.addHook("preHandler", (req, res, done) => {
      if (!req.user) {
        return res.redirect("/");
      }
      done();
    });
    server.get(`/dashboard`, (req, res) => {
      return redirectToFirstService(services, res);
    });
    for (let service of services) {
      const activeServiceName = service.getName();
      server.get(`/dashboard/${activeServiceName}`, async (req, reply) => {
        const serviceNames = services.map((s) => s.getName());
        const builds = await service.getBuilds();
        if (req.headers["hx-request"]) {
          const navigationTemplate = Handlebars.compile("{{>navigation}}");
          const navigationHtml = navigationTemplate({
            services: serviceNames,
            activeService: activeServiceName,
          });
          const buildTableTemplate = Handlebars.compile("{{>buildTable}}");
          const buildTableHtml = buildTableTemplate({
            serviceName: activeServiceName,
            environments: service.getEnvironments(),
            builds,
          });
          return reply
            .header("Content-Type", "text/html")
            .send(navigationHtml + buildTableHtml);
        }
        return reply.view(
          "dashboard",
          {
            services: serviceNames,
            activeService: activeServiceName,
            environments: service.getEnvironments(),
            builds,
          },
          {
            layout: "/layouts/main.hbs",
          },
        );
      });
    }
    done();
  };
}
export { redirectToFirstService } from "./redirectToFirstService";
