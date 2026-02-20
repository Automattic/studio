import fs from 'fs';
import { domainToASCII } from 'node:url';
import { platform, tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import * as Sentry from '@sentry/electron/main';
import { escapeRegex } from '@studio/common/lib/escape-regex';
import { sudoExec } from 'src/lib/sudo-exec';

const readFile = promisify( fs.readFile );
const writeFile = promisify( fs.writeFile );

// Host file paths for different operating systems
const HOST_FILES: Record< string, string > = {
	win32: path.resolve( process.env.SystemRoot ?? 'C:\\Windows', 'System32\\drivers\\etc\\hosts' ),
	darwin: '/etc/hosts',
	linux: '/etc/hosts',
};

// Get the appropriate hosts file path for the current platform
const getHostsFilePath = (): string => {
	const currentPlatform = platform();
	const hostsPath = HOST_FILES[ currentPlatform ];

	if ( ! hostsPath ) {
		throw new Error( `Unsupported platform: ${ currentPlatform }` );
	}

	return hostsPath;
};

/**
 * Reads the hosts file content
 */
export const readHostsFile = async (): Promise< string > => {
	try {
		const hostsPath = getHostsFilePath();
		const content = await readFile( hostsPath, 'utf8' );
		return content;
	} catch ( error ) {
		console.error( 'Error reading hosts file:', error );
		throw error;
	}
};

/**
 * Writes content to the hosts file (requires elevated permissions)
 */
export const writeHostsFile = async ( content: string ): Promise< void > => {
	const hostsPath = getHostsFilePath();
	try {
		const tempPath = path.join( tmpdir(), 'wp-studio-hosts' );
		await writeFile( tempPath, content );
		const command =
			platform() === 'win32'
				? `type ${ tempPath } > ${ hostsPath }`
				: `cat ${ tempPath } > ${ hostsPath }`;
		await sudoExec( command, {
			name: 'WordPress Studio',
		} );
	} catch ( error ) {
		console.error( 'Error writing hosts file:', error );
		throw error;
	}
};

/**
 * Create a regular expression matching the hosts entry for a given domain:
 *
 * 	127.0.0.1 foo.wp.cloud # Port 8000
 *
 * 	Remove backslashes as a security measure and escape regex special characters.
 */
export function createHostsEntryPattern( domain: string ): RegExp {
	const sanitizedDomain = domain.replace( /\\/g, '' );
	const escapedDomain = escapeRegex( sanitizedDomain );
	return new RegExp( `127\\.0\\.0\\.1\\s+${ escapedDomain }(\\s|$)`, 'i' );
}

/**
 * Adds a domain to the hosts file pointing to 127.0.0.1
 */
export const addDomainToHosts = async ( domain: string, port: number ): Promise< void > => {
	try {
		const hostsContent = await readHostsFile();
		const encodedDomain = domainToASCII( domain );

		const newContent = updateStudioBlock( hostsContent, ( entries ) => {
			const pattern = createHostsEntryPattern( encodedDomain );

			// No changes if domain already present
			if ( entries.some( ( entry ) => entry.match( pattern ) ) ) {
				return entries;
			}

			return [ ...entries, `127.0.0.1 ${ encodedDomain } # Port ${ port }` ];
		} );

		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
			console.log( `Domain ${ domain } added to hosts file for port ${ port }` );
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( `Error adding domain ${ domain } to hosts file:`, error );
		throw error;
	}
};

/**
 * Removes a domain from the hosts file
 */
export const removeDomainFromHosts = async ( domain: string ): Promise< void > => {
	try {
		const hostsContent = await readHostsFile();
		const encodedDomain = domainToASCII( domain );

		const pattern = createHostsEntryPattern( encodedDomain );
		const newContent = updateStudioBlock( hostsContent, ( entries ) =>
			entries.filter( ( entry ) => ! entry.match( pattern ) )
		);

		// Only write if content changed
		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error( `Error removing domain ${ domain } from hosts file:`, error );
		throw error;
	}
};

export const updateDomainInHosts = async (
	oldDomain: string | undefined,
	newDomain: string | undefined,
	port: number
): Promise< void > => {
	if ( oldDomain === newDomain ) {
		return;
	}

	if ( ! oldDomain && newDomain ) {
		await addDomainToHosts( newDomain, port );
		return;
	}

	if ( oldDomain && ! newDomain ) {
		await removeDomainFromHosts( oldDomain );
		return;
	}

	try {
		const hostsContent = await readHostsFile();
		const encodedOldDomain = domainToASCII( oldDomain as string );
		const encodedNewDomain = domainToASCII( newDomain as string );
		const oldPattern = createHostsEntryPattern( encodedOldDomain );
		const newContent = updateStudioBlock( hostsContent, ( entries ) => {
			const filtered = entries.filter( ( entry ) => ! entry.match( oldPattern ) );
			return [ ...filtered, `127.0.0.1 ${ encodedNewDomain } # Port ${ port }` ];
		} );

		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
		Sentry.captureException( error );
		console.error(
			`Error replacing domain ${ oldDomain } with ${ newDomain } in hosts file:`,
			error
		);
		throw error;
	}
};

/**
 * Helper function for manipulating the "block" of entries in the hosts file
 * pertaining to WordPres Studio.
 *
 * @param content - Content of the hosts file
 * @param updateFn - Function to map/filter over hosts entries
 */
function updateStudioBlock( content: string, updateFn: ( entries: string[] ) => string[] ): string {
	/**
	 * Regular expression matching a block of entries demarcated as follows:
	 *
	 * 	# BEGIN WordPress Studio
	 * 	127.0.0.1 foo.wp.cloud
	 * 	127.0.0.1 bar.wp.cloud
	 * 	# END WordPress Studio
	 */
	const STUDIO_BLOCK_PATTERN =
		/(^|\n)(# BEGIN WordPress Studio)([\s\S]*?)\n(# END WordPress Studio)/;

	const match = content.match( STUDIO_BLOCK_PATTERN );

	// Edit the existing "block" of Studio entries
	if ( match ) {
		const [ _, space, begin, block, end ] = match;

		const before = content.slice( 0, match.index );
		const after = content.slice( ( match.index ?? 0 ) + match[ 0 ].length );

		const entries = block.split( '\n' ).filter( Boolean );
		const newEntries = updateFn( entries );

		// Remove whole block if empty
		if ( ! newEntries.length ) {
			return before + after;
		}

		const newLines = [ begin, ...newEntries, end ];
		return before + space + newLines.join( '\n' ) + after;
	}
	// Append a new block to the hosts file
	else {
		const newEntries = updateFn( [] );
		if ( newEntries.length ) {
			return (
				content +
				[ '\n', '# BEGIN WordPress Studio', ...newEntries, '# END WordPress Studio' ].join( '\n' )
			);
		}
	}

	return content;
}
