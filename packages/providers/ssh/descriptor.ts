import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { isWpCliCommand, parseSshAddress } from './address';
import type { Provider, RemoteSite } from '../types';

// A WordPress site on a server Studio reaches with the user's `ssh`, and manages with WP-CLI there.
export interface SshSite extends RemoteSite {
	// Its address, as `formatSshAddress` writes it: `user@host:/path`, or `ssh://user@host:port/path`.
	id: string;
	// How to run WP-CLI on the server, such as `wp`.
	wpCli: string;
	// The server's WP_CONTENT_DIR, read when connecting.
	contentDir: string;
}

export const sshProvider: Provider< undefined, SshSite > = {
	id: 'ssh',
	label: 'SSH',
	description: () =>
		__( 'Push to and pull from a WordPress site on any server you reach over SSH.' ),
	icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m4 17 6-6-6-6"/><path d="M12 19h8"/></svg>',
	sites: {
		publish: true,
		hostOnly: true,
		publishing: {
			description: () => __( 'A WordPress site on your own server.' ),
		},
		pull: true,
		selective: true,
		content: 'archive',
		add: {
			input: () =>
				z.object( {
					address: z
						.string()
						.refine( ( value ) => parseSshAddress( value ) !== undefined, {
							message: __(
								'Enter the server and the WordPress folder, such as deploy@example.com:/var/www/html.'
							),
						} )
						.meta( {
							title: __( 'Server' ),
							description: __(
								'The SSH user, server and WordPress folder. Use ssh://user@server:port/folder for another port.'
							),
							examples: [ 'deploy@example.com:/var/www/html' ],
						} ),
					wpCli: z
						.string()
						.refine( ( value ) => ! value.trim() || isWpCliCommand( value.trim() ), {
							message: __( 'Enter the command that runs WP-CLI, such as wp or php ~/wp-cli.phar.' ),
						} )
						.meta( {
							title: __( 'WP-CLI command' ),
							description: __( 'How to run WP-CLI on the server, when it isn’t wp.' ),
							examples: [ 'wp' ],
						} ),
				} ),
		},
		intro: {
			title: () => __( 'Publish over SSH' ),
			description: () =>
				__(
					'Push to and pull from a WordPress site on any server you reach over SSH with a key, with WP-CLI installed there. Studio uses your SSH setup and never stores a password.'
				),
			learnMoreUrl: 'https://make.wordpress.org/cli/handbook/guides/installing/',
		},
		describe: ( site ) => {
			const target = parseSshAddress( site.id );
			return {
				details: target
					? [
							{ title: __( 'Server' ), value: target.destination },
							{ title: __( 'Folder' ), value: target.path },
					  ]
					: [],
				links: [
					{
						role: 'admin',
						title: __( 'Open WP Admin' ),
						url: new URL( 'wp-admin/', site.url.replace( /\/?$/, '/' ) ).href,
					},
				],
			};
		},
		issue: () => null,
		withDetails: ( connections ) => connections,
	},
};
