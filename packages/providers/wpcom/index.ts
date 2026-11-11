import { wpcomAccount } from './account';
import { wpcomAi } from './ai';
import { wpcomDescriptor } from './descriptor';
import { generateWpcomImages } from './images';
import type { WpcomConfig } from './config';
import type { Provider } from '../types';

export const wpcomProvider: Provider< WpcomConfig > = {
	descriptor: wpcomDescriptor,
	account: wpcomAccount,
	ai: { ...wpcomAi, generateImages: generateWpcomImages },
};
