import { __ } from '@wordpress/i18n';
import { z } from 'zod';

// Where a site lives on a server: `ssh <destination> -p <port>`, then `cd <path>`.
export interface SshTarget {
	// `host`, `user@host`, or an alias from the user's `~/.ssh/config`.
	destination: string;
	port?: number;
	// The WordPress root, absolute or relative to the login directory.
	path: string;
}

// No whitespace, shell metacharacters or leading `-`, which `ssh` would read as an option.
const DESTINATION = /^(?:[\w.-]+@)?[A-Za-z0-9][\w.-]*$/;

/**
 * Reads `user@host:/path` (scp's form) or `ssh://user@host:port/path`. Returns undefined when the
 * address names no host or no path.
 */
export function parseSshAddress( address: string ): SshTarget | undefined {
	const value = address.trim();
	let target: SshTarget;
	if ( value.startsWith( 'ssh://' ) ) {
		let url: URL;
		try {
			url = new URL( value );
		} catch {
			return undefined;
		}
		target = {
			destination: url.username
				? `${ decodeURIComponent( url.username ) }@${ url.hostname }`
				: url.hostname,
			path: decodeURIComponent( url.pathname ),
			...( url.port ? { port: Number( url.port ) } : {} ),
		};
	} else {
		const separator = value.indexOf( ':' );
		if ( separator < 0 ) {
			return undefined;
		}
		target = { destination: value.slice( 0, separator ), path: value.slice( separator + 1 ) };
	}
	target.path = sitePath( target.path );
	return DESTINATION.test( target.destination ) && isSitePath( target.path ) ? target : undefined;
}

export function sitePath( value: string ): string {
	return value.trim().replace( /(.)\/+$/, '$1' );
}

// Whether the value names a WordPress folder: not the server's root, on one line.
export function isSitePath( value: string ): boolean {
	const path = sitePath( value );
	return !! path && path !== '/' && ! /[\0\n\r]/.test( path );
}

// A host as `ssh` takes it: a name from the user's SSH config, `user@server` or `user@server:port`.
export function parseSshHost( value: string ): Omit< SshTarget, 'path' > | undefined {
	const match = /^([^:]+)(?::(\d{1,5}))?$/.exec( value.trim() );
	if ( ! match || ! DESTINATION.test( match[ 1 ] ) ) {
		return undefined;
	}
	return { destination: match[ 1 ], ...( match[ 2 ] ? { port: Number( match[ 2 ] ) } : {} ) };
}

// The address in one form, which identifies the site: scp's, or a URL when it needs a port.
export function formatSshAddress( { destination, port, path }: SshTarget ): string {
	return port ? `ssh://${ destination }:${ port }${ path }` : `${ destination }:${ path }`;
}

// A command such as `/opt/plesk/php/8.3/bin/php`: words of path characters, which the server's shell
// runs.
export function isPhpCommand( command: string ): boolean {
	return /^[\w./~@+=-]+(?: [\w./~@+=-]+)*$/.test( command );
}

// A host of the user's SSH config, with who and where it connects as.
export interface SshHost {
	name: string;
	description?: string;
}

// A host to add to the user's SSH config: each value goes on a config line of its own.
export const sshHostInput = () =>
	z.object( {
		name: z
			.string()
			.regex( /^[A-Za-z0-9][\w.-]*$/, {
				message: __( 'Use letters, numbers, dots, dashes and underscores.' ),
			} )
			.meta( { title: __( 'Name' ), examples: [ 'acme-production' ] } ),
		server: z
			.string()
			// The port has a field of its own.
			.refine( ( value ) => ! value.includes( ':' ) && !! parseSshHost( value ), {
				message: __( 'Enter the user and server, such as deploy@example.com.' ),
			} )
			.meta( {
				title: __( 'Server' ),
				description: __( 'The SSH user and server.' ),
				examples: [ 'deploy@example.com' ],
			} ),
		port: z
			.string()
			.regex( /^(\d{1,5})?$/, { message: __( 'Enter a port number.' ) } )
			.meta( {
				title: __( 'Port' ),
				description: __( 'Leave empty for 22.' ),
				examples: [ '22' ],
			} ),
		key: z
			.string()
			.regex( /^[^"\0\r\n]*$/, { message: __( 'Enter the path to a private key file.' ) } )
			.meta( {
				title: __( 'SSH key' ),
				description: __( 'A private key. Leave empty to use your SSH agent or config.' ),
				examples: [ '~/.ssh/id_ed25519' ],
			} ),
	} );
