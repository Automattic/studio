import { __ } from '@wordpress/i18n';
import { spacefastConfigSchema, type SpacefastConfig } from './config';
import type { ProviderDescriptor } from '../types';

export const spacefastDescriptor: ProviderDescriptor< SpacefastConfig > = {
	id: 'spacefast',
	label: 'Spacefast',
	description: () => __( 'Publish a static copy of your sites to a Spacefast Space.' ),
	learnMoreUrl: 'https://spacefast.com',
	configSchema: spacefastConfigSchema,
	connection: { kind: 'device' },
	sites: {},
};
