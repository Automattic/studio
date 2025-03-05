import fs from 'fs';
import { platform, tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';
import sudo from 'sudo-prompt';

const readFile = promisify( fs.readFile );
const writeFile = promisify( fs.writeFile );
const sudoExec = promisify( sudo.exec );

// Host file paths for different operating systems
const HOST_FILES: Record< string, string > = {
	win32: 'C:\\Windows\\System32\\drivers\\etc\\hosts',
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
		// @ts-expect-error promisify doesn't seem typed properly.
		await sudoExec( `cat ${ tempPath } > ${ hostsPath }`, {
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
 * 	127.0.0.1 foo.wp.cloud # Port 8000 (WordPress Studio)
 */
function createHostsEntryPattern( domain: string ): RegExp {
	return new RegExp( `127\\.0\\.0\\.1\\s+${ domain.replace( /\./g, '\\.' ) }(\\s|$)`, 'i' );
}

/**
 * Adds a domain to the hosts file pointing to 127.0.0.1
 */
export const addDomainToHosts = async ( domain: string, port: number ): Promise< void > => {
	try {
		const hostsContent = await readHostsFile();

		const newContent = updateStudioBlock( hostsContent, ( entries ) => {
			const pattern = createHostsEntryPattern( domain );

			// No changes if domain already present
			if ( entries.some( ( entry ) => entry.match( pattern ) ) ) {
				return entries;
			}

			return [ ...entries, `127.0.0.1 ${ domain } # Port ${ port } (WordPress Studio)` ];
		} );

		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
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

		const pattern = createHostsEntryPattern( domain );
		const newContent = updateStudioBlock( hostsContent, ( entries ) =>
			entries.filter( ( entry ) => ! entry.match( pattern ) )
		);

		// Only write if content changed
		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
		console.error( `Error removing domain ${ domain } from hosts file:`, error );
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
