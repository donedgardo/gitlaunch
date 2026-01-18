import { Db } from "mongodb";
import EventEmitter from "node:events";
import { MongoBuildStorage } from "./buildStorage/mongoBuildStorage";
import { Service } from "./service";
import { Environments } from "./buildStorage/environments";
import { GithubDispatchService } from "./service/githubDispatchService";

export function createServices(
  serviceNames: string[],
  database: Db,
  eventEmitter: EventEmitter,
) {
  return serviceNames.map((serviceName) =>
    createService(serviceName, database, eventEmitter),
  );
}

export function createService(
  serviceName: string,
  database: Db,
  eventEmitter: EventEmitter,
) {
  const buildStorage = new MongoBuildStorage(database, serviceName);
  const dispatchService = new GithubDispatchService(
    serviceName,
    process.env.GH_PAT as string,
    process.env.GH_ORG as string,
  );
  return new Service(serviceName, buildStorage, eventEmitter, dispatchService, [
    Environments.STAGING,
    Environments.PROD,
  ]);
}
