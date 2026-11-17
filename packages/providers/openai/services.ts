import { defineServices } from '../types';
import { openaiAccount } from './account';
import { openaiAi } from './ai';
import { openaiProvider } from './descriptor';

export const services = defineServices( openaiProvider, {
	account: openaiAccount,
	ai: openaiAi,
} );
