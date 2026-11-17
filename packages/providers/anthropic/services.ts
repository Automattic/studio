import { defineServices } from '../types';
import { anthropicAccount } from './account';
import { anthropicAi } from './ai';
import { anthropicProvider } from './descriptor';

export const services = defineServices( anthropicProvider, {
	account: anthropicAccount,
	ai: anthropicAi,
} );
