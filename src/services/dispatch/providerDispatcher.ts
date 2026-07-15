import { Account } from "../../repositories/accountRepository";
import { CIProvider, Service } from "../../repositories/serviceRepository";

export type DispatchContext = {
  account: Account;
  service: Service;
  buildId: string;
  environment: string;
};

// One implementation per CI provider. BuildDispatchService selects the right
// one by `provider`, so adding a provider means adding a dispatcher — not
// editing a switch (Open/Closed).
export interface ProviderDispatcher {
  readonly provider: CIProvider;
  dispatch(ctx: DispatchContext): Promise<void>;
}
