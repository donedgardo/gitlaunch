import { DbClientI } from "../../server/health/dbClientI";
import { MongoClient } from "mongodb";

export class MongoDbClient implements DbClientI {
  private dbClient: MongoClient;

  constructor(dbClient: MongoClient) {
    this.dbClient = dbClient;
  }

  async connect(): Promise<void> {
    await this.dbClient.connect();
    return Promise.resolve(undefined);
  }
}
