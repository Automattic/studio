import { connectWpcom, disconnectWpcom } from './account';
import { wpcomAi } from './ai';
import { wpcomDescriptor } from './descriptor';
import { generateWpcomImages } from './images';
import { wpcomSites } from './sites';
import type { WpcomConfig } from './config';
import type { SyncSite } from './site';
import type { Provider } from '../types';

export const wpcomProvider: Provider< WpcomConfig, SyncSite > = {
	descriptor: wpcomDescriptor,
	connect: connectWpcom,
	disconnect: disconnectWpcom,
	ai: { ...wpcomAi, generateImages: generateWpcomImages },
	sites: wpcomSites,
};
