export interface DbClientI {
  connect(): Promise<void>;
}
