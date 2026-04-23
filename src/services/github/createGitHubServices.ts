import { AccountRepository } from "../../repositories/accountRepository";
import {
  GitHubOAuthService,
  GitHubHttpClient,
} from "../auth/githubOAuthService";
import { GitHubAppService } from "./githubAppService";
import { GitHubAppClient } from "./githubAppClient";
import { InstallationTokenService } from "./installationTokenService";
import { GitHubApiClient } from "./githubApiClient";
import {
  FakeGitHubHttpClient,
  FakeGitHubApiClient,
  FakeGitHubAppClient,
} from "./fakes";

export type GitHubServices = {
  githubOAuthService: GitHubOAuthService;
  gitHubAppService: GitHubAppService;
  installationTokenService: InstallationTokenService;
};

type GitHubConfig = {
  useFakes: boolean;
  clientId?: string;
  clientSecret?: string;
  appId?: string;
  privateKey?: string;
  publicUrl?: string;
};

export function createGitHubServices(
  accountRepository: AccountRepository,
  config: GitHubConfig,
): GitHubServices {
  if (config.useFakes) {
    console.info("Using fake GitHub services (USE_FAKE_GITHUB=true)");
  }

  const httpClient = config.useFakes
    ? new FakeGitHubHttpClient()
    : new GitHubHttpClient(config.clientId!, config.clientSecret!);

  const githubOAuthService = new GitHubOAuthService(httpClient, {
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: `${config.publicUrl}/auth/github/callback`,
  });

  const appClient = config.useFakes
    ? new FakeGitHubAppClient()
    : new GitHubAppClient({
        appId: config.appId!,
        privateKey: config.privateKey!,
      });

  const installationTokenService = new InstallationTokenService(appClient);

  const apiClient = config.useFakes
    ? new FakeGitHubApiClient()
    : new GitHubApiClient();

  const gitHubAppService = new GitHubAppService(
    accountRepository,
    installationTokenService,
    apiClient,
  );

  return {
    githubOAuthService,
    gitHubAppService,
    installationTokenService,
  };
}
