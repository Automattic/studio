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
		const domainRegex = new RegExp( `127\\.0\\.0\\.1\\s+${ domain.replace( /\./g, '\\.' ) }`, 'i' );
		if ( domainRegex.test( hostsContent ) ) {
			return; // Domain already exists
		}

		// Add the domain entry with comment showing the port for reference
		const newEntry = `\n# Added by WordPress Studio (Port: ${ port })\n127.0.0.1\t${ domain }`;
		const newContent = hostsContent + newEntry;

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

		// Remove the domain entry and the comment line
		// Match both formats of comments (with and without port)
		const pattern = new RegExp(
			`\\n# Added by WordPress Studio(?: \\(Port: \\d+\\))?\\n127\\.0\\.0\\.1\\s+${ domain.replace(
				/\./g,
				'\\.'
			) }`,
			'i'
		);
		const newContent = hostsContent.replace( pattern, '' );

		if ( newContent !== hostsContent ) {
			await writeHostsFile( newContent );
		}
	} catch ( error ) {
		console.error( `Error removing domain ${ domain } from hosts file:`, error );
		throw error;
	}
};
