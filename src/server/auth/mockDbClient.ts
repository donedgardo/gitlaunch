import { DbClientI } from "../health/dbClientI";

export class MockDbClient implements DbClientI {
  connect(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
