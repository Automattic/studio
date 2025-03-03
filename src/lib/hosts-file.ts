import fs from 'fs';
import { platform } from 'os';
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
		const tempPath = '/tmp/wp-studio-hosts';
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
 * Adds a domain to the hosts file pointing to 127.0.0.1
 */
export const addDomainToHosts = async ( domain: string, port: number ): Promise< void > => {
	try {
		const hostsContent = await readHostsFile();

		// Check if the domain is already in the hosts file
		const domainRegex = new RegExp(
			`^127\\.0\\.0\\.1\\s+${ domain.replace( /\./g, '\\.' ) }`,
			'i'
		);
		if ( domainRegex.test( hostsContent ) ) {
			return; // Domain already exists
		}

		// Define markers for WordPress Studio block
		const beginMarker = '# BEGIN WordPress Studio';
		const endMarker = '# END WordPress Studio';

		// Create the domain entry with port reference
		const domainEntry = `127.0.0.1\t${ domain } # Port: ${ port }`;

		// Check if WordPress Studio block already exists
		// Use non-greedy matching to avoid capturing multiple blocks at once
		const blockRegex = new RegExp( `(${ beginMarker })[\\s\\S]*?(${ endMarker })` );
		const blockMatch = hostsContent.match( blockRegex );

		let newContent;

		if ( blockMatch ) {
			// Extract existing entries between markers
			const existingBlock = blockMatch[ 0 ];
			const entries = existingBlock
				.split( '\n' )
				.filter( ( line ) => line !== beginMarker && line !== endMarker && line.trim() !== '' );

			// Add new entry to entries
			entries.push( domainEntry );

			// Create updated block with entries
			const updatedBlock = `${ beginMarker }\n${ entries.join( '\n' ) }\n${ endMarker }`;

			// Replace old block with updated block
			newContent = hostsContent.replace( blockRegex, updatedBlock );
		} else {
			// Create new block with the domain entry
			const newBlock = `\n\n${ beginMarker }\n${ domainEntry }\n${ endMarker }\n`;
			newContent = hostsContent + newBlock;
		}

		await writeHostsFile( newContent );
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

		// Check if the domain is already in the hosts file
		const domainRegex = new RegExp(
			`^127\\.0\\.0\\.1\\s+${ domain.replace( /\./g, '\\.' ) }`,
			'i'
		);
		if ( ! domainRegex.test( hostsContent ) ) {
			return; // Domain doesn't exist
		}

		// All WordPress Studio entries will be grouped in a block
		const beginMarker = '# BEGIN WordPress Studio';
		const endMarker = '# END WordPress Studio';

		// Find the Studio block, if any. For performance, avoid greedy
		// searches; there should only be a small block anyway.
		const blockRegex = new RegExp( `(${ beginMarker })[\\s\\S]*?(${ endMarker })` );
		const blockMatch = hostsContent.match( blockRegex );

		let newContent = hostsContent;

		if ( blockMatch ) {
			// Split into lines to remove domain entry
			const block = blockMatch[ 0 ];
			const lines = block.split( '\n' );
			const remainingLines = lines.filter(
				( line ) =>
					line === beginMarker ||
					line === endMarker ||
					( line.trim() !== '' && ! domainRegex.test( line ) )
			);

			if ( remainingLines.length <= 2 ) {
				// Only markers left, remove entire block
				newContent = newContent.replace( block, '' );
				// Clean up extra newlines
				newContent = newContent.replace( /\n\n\n+/g, '\n\n' );
			} else {
				// Create updated block with remaining entries
				const updatedBlock = remainingLines.join( '\n' );
				newContent = newContent.replace( block, updatedBlock );
			}
		}

		// Only write if content changed
		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
		console.error( `Error removing domain ${ domain } from hosts file:`, error );
		throw error;
	}
};
