import { connectCustom } from './account';
import { customAi } from './ai';
import { customDescriptor } from './descriptor';
import type { CustomConfig } from './config';
import type { Provider } from '../types';

export const customProvider: Provider< CustomConfig > = {
	descriptor: customDescriptor,
	connect: connectCustom,
	ai: customAi,
};
