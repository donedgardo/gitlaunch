import { IDispatchService } from "./IDispatchService";

export class MockDispatchService implements IDispatchService {
  private wasCalled: boolean = false;
  dispatch(_env: string, _buildId: string): Promise<void> {
    this.wasCalled = true;
    return Promise.resolve(undefined);
  }
  toHaveBeenCalled(): boolean {
    return this.wasCalled;
  }
}
