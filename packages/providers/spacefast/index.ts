import { connectSpacefast, startSpacefastConnect } from './account';
import { spacefastDescriptor } from './descriptor';
import { spacefastSites } from './sites';
import type { SpacefastConfig } from './config';
import type { Space } from './site';
import type { Provider } from '../types';

export const spacefastProvider: Provider< SpacefastConfig, Space > = {
	descriptor: spacefastDescriptor,
	connect: connectSpacefast,
	startConnect: startSpacefastConnect,
	sites: spacefastSites,
};
