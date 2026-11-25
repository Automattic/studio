import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { isPhpCommand, isSitePath, parseSshAddress, parseSshHost } from './address';
import type { Provider, RemoteSite } from '../types';

// A WordPress site on a server Studio reaches with the user's `ssh`, and manages there with its own
// WP-CLI.
export interface SshSite extends RemoteSite {
	// Its address, as `formatSshAddress` writes it: `user@host:/path`, or `ssh://user@host:port/path`.
	id: string;
	// How to run PHP on the server, when it isn't `php`.
	php?: string;
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
		summary: () => __( 'A WordPress site on your own server.' ),
		pull: true,
		selective: true,
		content: 'archive',
		connect: {
			// The user's `ssh` reaches the server.
			hostOnly: true,
			input: () =>
				z.object( {
					host: z
						.string()
						.refine( ( value ) => parseSshHost( value ) !== undefined, {
							message: __( 'Enter a host from your SSH config, or user@server.' ),
						} )
						.meta( { title: __( 'Host' ), examples: [ 'deploy@example.com' ] } ),
					path: z
						.string()
						.refine( isSitePath, {
							message: __( 'Enter the folder WordPress is in, such as /var/www/html.' ),
						} )
						.meta( {
							title: __( 'WordPress folder' ),
							description: __( 'The folder with wp-config.php on the server.' ),
							examples: [ '/var/www/html' ],
						} ),
					php: z
						.string()
						.refine( ( value ) => ! value.trim() || isPhpCommand( value.trim() ), {
							message: __(
								'Enter the command that runs PHP, such as php or /opt/plesk/php/8.3/bin/php.'
							),
						} )
						.meta( {
							title: __( 'PHP command' ),
							description: __( 'How to run PHP on the server, when it isn’t php.' ),
							examples: [ 'php' ],
						} ),
				} ),
		},
		intro: {
			title: () => __( 'Publish over SSH' ),
			description: () =>
				__(
					'Push to and pull from a WordPress site on any server you reach over SSH with a key and that runs PHP. Studio uses your SSH setup and never stores a password.'
				),
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
				links: [],
			};
		},
	},
};
