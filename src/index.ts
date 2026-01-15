import "dotenv/config";
import createServer from "./server";
import { GoogleOAuthService } from "./services/auth/googleOAuthService";
import { MockEventEmitter } from "./server/test.helpers";
import { MongoClient } from "mongodb";
import { createServices } from "./services/createServices";
import { MongoDbClient } from "./services/auth/mongoDbClient";

const googleOAuthService = new GoogleOAuthService();
googleOAuthService.setApiKey(process.env.API_KEY as string);

const eventEmitter = new MockEventEmitter();

const mongodb_uri = process.env.MONGODB_URI as string;
const client = new MongoClient(mongodb_uri);
const database = client.db("launchpad");

const serviceNames = (process.env.SERVICES as string)
  .split(",")
  .map((s) => s.trim());

const services = createServices(serviceNames, database, eventEmitter);

const server = createServer(
  googleOAuthService,
  eventEmitter,
  services,
  new MongoDbClient(client),
);

const PORT = parseInt(process.env.PORT as string);

server.listen({ host: "0.0.0.0", port: PORT }).then(() => {
  console.info(`Server listening in ${PORT}`);
});
