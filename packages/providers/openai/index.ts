import { connectOpenai, refreshOpenai, startOpenaiConnect } from './account';
import { openaiAi } from './ai';
import { openaiDescriptor } from './descriptor';
import type { OpenaiConfig } from './config';
import type { Provider } from '../types';

export const openaiProvider: Provider< OpenaiConfig > = {
	descriptor: openaiDescriptor,
	connect: connectOpenai,
	startLoopbackConnect: startOpenaiConnect,
	refresh: refreshOpenai,
	ai: openaiAi,
};
