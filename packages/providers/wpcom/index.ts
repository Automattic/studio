import { connectWpcom, disconnectWpcom } from './account';
import { wpcomAi } from './ai';
import { wpcomDescriptor } from './descriptor';
import { generateWpcomImages } from './images';
import type { WpcomConfig } from './config';
import type { Provider } from '../types';

export const wpcomProvider: Provider< WpcomConfig > = {
	descriptor: wpcomDescriptor,
	connect: connectWpcom,
	disconnect: disconnectWpcom,
	ai: { ...wpcomAi, generateImages: generateWpcomImages },
};
