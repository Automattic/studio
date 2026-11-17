import { defineServices } from '../types';
import { githubCopilotAccount } from './account';
import { githubCopilotAi } from './ai';
import { githubCopilotProvider } from './descriptor';

export const services = defineServices( githubCopilotProvider, {
	account: githubCopilotAccount,
	ai: githubCopilotAi,
} );
