import { __ } from '@wordpress/i18n';
import { spacefastConfigSchema, type SpacefastConfig } from './config';
import { spaceDetails, withSpaceDetails, type Space } from './site';
import type { ProviderDescriptor } from '../types';

export const spacefastDescriptor: ProviderDescriptor< SpacefastConfig, Space > = {
	id: 'spacefast',
	label: 'Spacefast',
	description: () => __( 'Publish a static copy of your sites to a Spacefast Space.' ),
	learnMoreUrl: 'https://spacefast.com',
	configSchema: spacefastConfigSchema,
	connection: { kind: 'device' },
	sites: {
		publishing: {
			staticSiteLabel: () => __( 'Make it with Spacefast' ),
			description: () => __( 'A fast, simple version of your pages' ),
			addressTheme: 'twilight',
		},
		logo: {
			color: 'green',
			viewBox: '0 0 85 75',
			path: 'M43.7082 46.0672L17.1083 43.7287C5.39028 42.6764 0 38.818 0 27.1258L0 17.5383C0 5.72917 5.859 0 17.577 0L66.7926 0C78.5106 0 84.3696 5.84609 84.3696 17.5383V24.5536L49.2156 24.5536L49.2156 19.8767H35.154V20.3444C35.154 25.0212 35.7399 25.372 40.4271 25.7228L66.0896 27.9443C77.8076 28.8797 84.3696 34.0242 84.3696 45.7164V56.707C84.3696 68.3992 78.5106 74.2453 66.7926 74.2453L17.577 74.2453C5.74182 74.2453 0 68.3992 0 56.707L0 47.3533L35.154 47.3533V54.3686H49.2156V51.6794C49.2156 47.0025 48.3954 46.4179 43.7082 46.0672Z',
		},
		visibility: () => true,
		visibilityOptions: () => [
			{
				value: 'private',
				label: __( 'Restricted' ),
				description: __( 'Only people with access can view' ),
			},
			{ value: 'public', label: __( 'Everyone' ), description: __( 'Anyone can view your site' ) },
		],
		visibilitySettingsLink: () => ( {
			title: __( 'Manage on Spacefast' ),
			url: 'https://my.spacefast.com/',
		} ),
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
		details: spaceDetails,
		links: () => [],
		dashboardUrl: () => 'https://my.spacefast.com/',
		domainSettingsUrl: ( site ) =>
			site.teamSlug && site.slug
				? `https://my.spacefast.com/${ encodeURIComponent( site.teamSlug ) }/${ encodeURIComponent(
						site.slug
				  ) }/domains`
				: undefined,
		issue: () => null,
		withDetails: withSpaceDetails,
	},
};
