import { __ } from '@wordpress/i18n';
import { spacefastConfigSchema, type SpacefastConfig } from './config';
import type { Provider } from '../types';

// A Space: a static site on Spacefast, served at `url`, in one of the account's teams.
export interface Space {
	id: string;
	name: string;
	url: string;
	slug: string;
	teamId: string;
	teamName?: string;
	teamSlug?: string;
}

export const spacefastProvider: Provider< SpacefastConfig, Space > = {
	id: 'spacefast',
	label: 'Spacefast',
	description: () => __( 'Publish a static copy of your sites to a Spacefast Space.' ),
	learnMoreUrl: 'https://spacefast.com',
	// https://spacefast.com/favicon.svg
	logo: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#1EFE57"/><path fill="#000" transform="translate(21.6902 22.4527) scale(3.48975)" d="M144.237 162.275L78.975 156.525C50.225 153.938 37 144.45 37 115.7L37 92.125C37 63.0875 51.375 49 80.125 49L200.875 49C229.625 49 244 63.375 244 92.125V109.375H157.75V97.875L123.25 97.875V99.025C123.25 110.525 124.687 111.388 136.188 112.25L199.15 117.713C227.9 120.013 244 132.663 244 161.413V188.438C244 217.188 229.625 231.563 200.875 231.563L80.125 231.563C51.0875 231.563 37 217.188 37 188.438V165.438H123.25L123.25 182.688L157.75 182.688L157.75 176.075C157.75 164.575 155.738 163.138 144.237 162.275Z"/></svg>',
	account: {
		configSchema: spacefastConfigSchema,
		methods: [ { id: 'sign-in', label: () => __( 'Connect' ), kind: 'device' } ],
		describe: () => ( { method: 'sign-in' } ),
		expiresAt: ( config ) => ( config.expiresAt ? Date.parse( config.expiresAt ) : undefined ),
	},
	sites: {
		publishing: {
			staticSiteLabel: () => __( 'Make it with Spacefast' ),
			description: () => __( 'A fast, simple version of your pages' ),
			addressTheme: 'twilight',
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
		content: 'static',
		newSite: 'create',
		visibilityAtCreation: true,
		intro: {
			title: () => __( 'Publish to Spacefast' ),
			description: () =>
				__(
					'Publish a static copy of your site to a Spacefast Space. Forms, comments and other features that need WordPress running won’t work in the copy.'
				),
			learnMoreUrl: 'https://spacefast.com',
		},
		describe: ( space ) => ( {
			details: space.teamName ? [ { title: __( 'Team' ), value: space.teamName } ] : [],
			links: [],
		} ),
		dashboardUrl: () => 'https://my.spacefast.com/',
		domainSettingsUrl: ( site ) =>
			site.teamSlug && site.slug
				? `https://my.spacefast.com/${ encodeURIComponent( site.teamSlug ) }/${ encodeURIComponent(
						site.slug
				  ) }/domains`
				: undefined,
		issue: () => null,
		// A Space renamed on Spacefast shows its new name; one gone from the account keeps the
		// stored one.
		withDetails: ( connections, spaces ) =>
			connections.map( ( connection ) => ( {
				...connection,
				...spaces.find( ( space ) => space.id === connection.id ),
			} ) ),
	},
};
