import { __ } from '@wordpress/i18n';
import { spacefastConfigSchema, type SpacefastConfig } from './config';
import { spaceAddress, spaceDetails, withSpaceDetails, type Space } from './site';
import type { ProviderDescriptor } from '../types';

export const spacefastDescriptor: ProviderDescriptor< SpacefastConfig, Space > = {
	id: 'spacefast',
	label: 'Spacefast',
	description: () => __( 'Publish a static copy of your sites to a Spacefast Space.' ),
	learnMoreUrl: 'https://spacefast.com',
	configSchema: spacefastConfigSchema,
	connection: { kind: 'device' },
	sites: {
		pull: false,
		selective: false,
		exportsStaticSite: true,
		newSite: 'create',
		intro: {
			title: () => __( 'Publish to Spacefast' ),
			description: () =>
				__(
					'Publish a static copy of your site to a Spacefast Space. Forms, comments and other features that need WordPress running won’t work in the copy.'
				),
			learnMoreUrl: 'https://spacefast.com',
		},
		address: spaceAddress,
		details: spaceDetails,
		links: () => [],
		issue: () => null,
		withDetails: withSpaceDetails,
	},
};
