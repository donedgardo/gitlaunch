import { FastifyInstance } from "fastify";

export default function () {
  return function (server: FastifyInstance, opts: any, done: any) {
    server.get("/", (req, res) => {
      // If user is logged in (has session), redirect to dashboard
      if (req.session) {
        return res.redirect("/dashboard");
      }
      // Show landing page for non-logged in users
      return res.view(
        "index.hbs",
        {},
        {
          layout: "/layouts/main.hbs",
        },
      );
    });
    done();
  };
}
