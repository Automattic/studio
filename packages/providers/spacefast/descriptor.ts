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
}

export const spacefastProvider: Provider< SpacefastConfig, Space > = {
	id: 'spacefast',
	label: 'Spacefast',
	description: () => __( 'Publish a static copy of your sites to a Spacefast Space.' ),
	learnMoreUrl: 'https://spacefast.com',
	account: {
		configSchema: spacefastConfigSchema,
		methods: [ { id: 'sign-in', label: () => __( 'Connect' ), kind: 'device' } ],
		describe: () => ( { method: 'sign-in' } ),
		expiresAt: ( config ) => ( config.expiresAt ? Date.parse( config.expiresAt ) : undefined ),
	},
	sites: {
		pull: false,
		selective: false,
		content: 'static',
		newSite: 'create',
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
