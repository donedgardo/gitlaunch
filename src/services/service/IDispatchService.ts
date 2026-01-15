export interface IDispatchService {
  dispatch(env: string, buildId: string): Promise<void>;
}
