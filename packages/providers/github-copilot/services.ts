import { githubCopilotAccount } from './account';
import { githubCopilotAi } from './ai';
import type { GithubCopilotConfig } from './config';
import type { ProviderServices } from '../types';

export const githubCopilotServices: ProviderServices< GithubCopilotConfig > = {
	id: 'github-copilot',
	account: githubCopilotAccount,
	ai: githubCopilotAi,
};
