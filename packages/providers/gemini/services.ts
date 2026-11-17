import { defineServices } from '../types';
import { geminiAccount } from './account';
import { geminiAi } from './ai';
import { geminiProvider } from './descriptor';

export const services = defineServices( geminiProvider, {
	account: geminiAccount,
	ai: geminiAi,
} );
