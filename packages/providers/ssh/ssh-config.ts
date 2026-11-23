import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { glob, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { __, sprintf } from '@wordpress/i18n';
import { writeFile } from 'atomically';
import { RemoteSiteError } from '../errors';
import { parseSshHost, type SshHost } from './address';
import { runSsh, sshExecutable } from './shell';

// Hosts the user adds in Studio go to a file of Studio's own, which their config includes first.
const STUDIO_CONFIG = 'studio_config';

const sshFolder = () => path.join( os.homedir(), '.ssh' );

const expandHome = ( file: string ) => file.replace( /^~(?=$|[\\/])/, os.homedir() );

// An ssh_config line's keyword and values: `Keyword value…` or `Keyword=value`, with double quotes.
function words( line: string ): string[] {
	if ( /^\s*#/.test( line ) ) {
		return [];
	}
	return ( line.match( /"[^"]*"|[^\s="]+/g ) ?? [] ).map( ( word ) =>
		word.replace( /^"|"$/g, '' )
	);
}

// The files an `Include` names, relative to ~/.ssh, expanding its glob patterns in order.
async function includedFiles( pattern: string ): Promise< string[] > {
	const files: string[] = [];
	const absolute = path.resolve( sshFolder(), expandHome( pattern ) );
	for await ( const file of glob( absolute.split( path.sep ).join( '/' ) ) ) {
		files.push( file );
	}
	return files.sort();
}

// The host names a config file and the files it includes declare, without patterns.
async function hostNames( file: string, seen = new Set< string >() ): Promise< string[] > {
	if ( seen.has( file ) || seen.size > 64 ) {
		return [];
	}
	seen.add( file );
	const names: string[] = [];
	for ( const line of ( await readFile( file, 'utf8' ).catch( () => '' ) ).split( /\r?\n/ ) ) {
		const [ keyword, ...values ] = words( line );
		if ( keyword?.toLowerCase() === 'host' ) {
			names.push( ...values.filter( ( value ) => parseSshHost( value ) ) );
		} else if ( keyword?.toLowerCase() === 'include' ) {
			for ( const pattern of values ) {
				for ( const included of await includedFiles( pattern ) ) {
					names.push( ...( await hostNames( included, seen ) ) );
				}
			}
		}
	}
	return names;
}

const userHostNames = async () => new Set( await hostNames( path.join( sshFolder(), 'config' ) ) );

// Who and where the host connects as, which `ssh -G` reads from the config without connecting.
async function describeHost( name: string ): Promise< string | undefined > {
	try {
		const { stdout } = await promisify( execFile )( sshExecutable(), [ '-G', '--', name ], {
			timeout: 5000,
		} );
		const option = ( key: string ) => new RegExp( `^${ key } (.+)$`, 'm' ).exec( stdout )?.[ 1 ];
		const port = option( 'port' );
		return `${ option( 'user' ) }@${ option( 'hostname' ) }${
			port && port !== '22' ? `:${ port }` : ''
		}`;
	} catch {
		return undefined;
	}
}

const sshHost = async ( name: string ): Promise< SshHost > => ( {
	name,
	description: await describeHost( name ),
} );

// The hosts of the user's SSH config.
export async function listSshHosts(): Promise< SshHost[] > {
	return Promise.all( [ ...( await userHostNames() ) ].map( sshHost ) );
}

// Replaces the file in one step, through a link to it, keeping its permissions.
const writeConfig = ( file: string, text: string ) =>
	writeFile( file, text, existsSync( file ) ? {} : { mode: 0o600 } );

// Puts `Include ~/.ssh/studio_config` first in the user's config, once.
async function includeStudioConfig() {
	const file = path.join( sshFolder(), 'config' );
	const text = await readFile( file, 'utf8' ).catch( () => '' );
	const included = text.split( /\r?\n/ ).some( ( line ) => {
		const [ keyword, ...values ] = words( line );
		return (
			keyword?.toLowerCase() === 'include' &&
			values.some( ( value ) => path.basename( value ) === STUDIO_CONFIG )
		);
	} );
	if ( ! included ) {
		await writeConfig( file, `Include ~/.ssh/${ STUDIO_CONFIG }\n\n${ text }` );
	}
}

const quoteValue = ( value: string ) => ( /\s/.test( value ) ? `"${ value }"` : value );

/**
 * Adds a host to the user's SSH config, in Studio's file, once `ssh` reached it with the host's
 * settings. Trusts the server's host key, as connecting a site does.
 */
export async function addSshHost( host: {
	name: string;
	server: string;
	port?: string;
	key?: string;
} ): Promise< SshHost > {
	if ( ( await userHostNames() ).has( host.name ) ) {
		throw new RemoteSiteError(
			// translators: %s: a host name in the user's SSH config
			sprintf( __( 'Your SSH config already has a host named %s.' ), host.name ),
			'ssh_address'
		);
	}
	if ( host.key && ! existsSync( expandHome( host.key ) ) ) {
		throw new RemoteSiteError(
			// translators: %s: a file path, such as ~/.ssh/id_ed25519
			sprintf( __( 'There’s no SSH key at %s.' ), host.key ),
			'ssh_auth'
		);
	}
	const at = host.server.lastIndexOf( '@' );
	const block = [
		`Host ${ host.name }`,
		`\tHostName ${ host.server.slice( at + 1 ) }`,
		at > 0 && `\tUser ${ host.server.slice( 0, at ) }`,
		host.port && `\tPort ${ host.port }`,
		host.key && `\tIdentityFile ${ quoteValue( host.key ) }`,
		host.key && '\tIdentitiesOnly yes',
	]
		.filter( Boolean )
		.join( '\n' );
	const file = path.join( sshFolder(), STUDIO_CONFIG );
	const before = await readFile( file, 'utf8' ).catch( () => '' );
	await mkdir( sshFolder(), { recursive: true, mode: 0o700 } );
	await writeConfig( file, `${ before.trimEnd() }${ before.trim() ? '\n\n' : '' }${ block }\n` );
	try {
		await includeStudioConfig();
		await runSsh( { destination: host.name }, 'true', { acceptNewHostKey: true } );
	} catch ( error ) {
		await writeConfig( file, before );
		throw error;
	}
	return sshHost( host.name );
}
