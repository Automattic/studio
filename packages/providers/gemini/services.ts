import { geminiAccount } from './account';
import { geminiAi } from './ai';
import type { GeminiConfig } from './config';
import type { ProviderServices } from '../types';

export const geminiServices: ProviderServices< GeminiConfig > = {
	id: 'gemini',
	account: geminiAccount,
	ai: geminiAi,
};
