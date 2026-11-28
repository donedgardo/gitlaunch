import { ObjectId } from "mongodb";
import { FlagServiceI } from "../flag/flagService";
import { SelfFlagAccount, SelfFlagContext } from "../flag/selfFlagContext";
import { ServiceRepository } from "../../repositories/serviceRepository";

// Dogfooding: whether the MCP server is switched on for an account is decided
// by GitLaunch's own feature-flag engine, keyed on the account. That gives a
// per-account rollout and a kill switch from the flags page.
export const MCP_FLAG_KEY = "mcp-server";

// What the endpoint asks before serving an account.
export interface McpAccess {
  allows(accountId: ObjectId): Promise<boolean>;
}

/**
 * Fails CLOSED, unlike the signup gate. The signup gate must never lock a
 * customer out, so it opens when it cannot get an answer. This guards a new
 * way to change production, so every path without a real "yes" — flags not
 * configured, flag not created, lookup failed — is a "no".
 */
export class McpGate implements McpAccess {
  private account: SelfFlagAccount;

  constructor(
    private flags: Pick<FlagServiceI, "evaluateOne">,
    services: ServiceRepository,
    private config: SelfFlagContext,
    warn?: (message: string) => void,
  ) {
    this.account = new SelfFlagAccount(services, config, warn);
  }

  async allows(accountId: ObjectId): Promise<boolean> {
    if (!this.account.configured) return false;
    const ownAccountId = await this.account.resolve();
    if (!ownAccountId) return false;
    try {
      const evaluation = await this.flags.evaluateOne(
        ownAccountId,
        this.config.serviceId!,
        this.config.environment,
        MCP_FLAG_KEY,
        accountId.toString(),
      );
      return evaluation?.enabled === true;
    } catch {
      return false;
    }
  }
}
