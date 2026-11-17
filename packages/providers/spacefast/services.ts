import { defineServices } from '../types';
import { spacefastAccount } from './account';
import { spacefastProvider } from './descriptor';
import { spacefastSites } from './sites';

export const services = defineServices( spacefastProvider, {
	account: spacefastAccount,
	sites: spacefastSites,
} );
