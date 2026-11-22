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
	target.path = target.path.replace( /(.)\/+$/, '$1' );
	if (
		! DESTINATION.test( target.destination ) ||
		! target.path ||
		target.path === '/' ||
		/[\0\n\r]/.test( target.path )
	) {
		return undefined;
	}
	return target;
}

// The address in one form, which identifies the site: scp's, or a URL when it needs a port.
export function formatSshAddress( { destination, port, path }: SshTarget ): string {
	return port ? `ssh://${ destination }:${ port }${ path }` : `${ destination }:${ path }`;
}

// A command such as `php ~/bin/wp-cli.phar`: words of path characters, which the server's shell runs.
export function isWpCliCommand( command: string ): boolean {
	return /^[\w./~@+=-]+(?: [\w./~@+=-]+)*$/.test( command );
}
