import { defineServices } from '../types';
import { wpcomAccount } from './account';
import { wpcomAi } from './ai';
import { wpcomProvider } from './descriptor';
import { wpcomSites } from './sites';

export const services = defineServices( wpcomProvider, {
	account: wpcomAccount,
	ai: wpcomAi,
	sites: wpcomSites,
} );
