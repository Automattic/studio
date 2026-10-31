import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { browserConfig, SUPPORTED_BROWSERS, type SystemBrowser } from './browser';

const macBrowserScript = `
ObjC.import('AppKit');
var url = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString('https://example.com'));
var bundle = $.NSBundle.bundleWithURL(url);
JSON.stringify({name: ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleDisplayName')) || ObjC.unwrap(bundle.objectForInfoDictionaryKey('CFBundleName'))});
`;

function readCommand( command: string, args: string[] ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		execFile(
			command,
			args,
			{ encoding: 'utf8', timeout: 2000, windowsHide: true },
			( error, stdout ) => {
				if ( error ) reject( error );
				else resolve( stdout.trim() );
			}
		);
	} );
}

function identifyBrowser( name: string ): SystemBrowser {
	const browser = SUPPORTED_BROWSERS.find( ( key ) =>
		name.toLowerCase().includes( browserConfig[ key ].name.toLowerCase() )
	);
	return { name, ...( browser ? { browser } : {} ) };
}

function registryValue( output: string, name: string ) {
	return output
		.split( /\r?\n/ )
		.map( ( line ) => line.trim() )
		.find( ( line ) => line.startsWith( `${ name } ` ) )
		?.replace( /^\S+\s+REG_\S+\s+/, '' );
}

export async function detectDefaultBrowser(): Promise< SystemBrowser | null > {
	try {
		if ( process.platform === 'darwin' ) {
			const result: unknown = JSON.parse(
				await readCommand( '/usr/bin/osascript', [ '-l', 'JavaScript', '-e', macBrowserScript ] )
			);
			if (
				result &&
				typeof result === 'object' &&
				'name' in result &&
				typeof result.name === 'string' &&
				result.name.trim()
			) {
				return identifyBrowser( result.name.trim() );
			}
		}
		if ( process.platform === 'win32' ) {
			const choice = await readCommand( 'reg.exe', [
				'query',
				'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
				'/v',
				'ProgId',
			] );
			const progId = registryValue( choice, 'ProgId' );
			if ( ! progId || ! /^[\w.-]+$/.test( progId ) ) return null;
			const application = await readCommand( 'reg.exe', [
				'query',
				`HKCR\\${ progId }\\Application`,
				'/v',
				'ApplicationName',
			] );
			const name = registryValue( application, 'ApplicationName' );
			return name && ! name.startsWith( '@' ) ? identifyBrowser( name ) : null;
		}
		if ( process.platform === 'linux' ) {
			const desktop = await readCommand( 'xdg-settings', [ 'get', 'default-web-browser' ] );
			if ( ! desktop.endsWith( '.desktop' ) || path.basename( desktop ) !== desktop ) return null;
			const directories = [
				process.env.XDG_DATA_HOME || path.join( os.homedir(), '.local/share' ),
				...( process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share' ).split( ':' ),
			];
			for ( const directory of directories ) {
				try {
					const entry = await fs.readFile(
						path.join( directory, 'applications', desktop ),
						'utf8'
					);
					const section = entry.split( /^\[Desktop Entry\]\s*$/m )[ 1 ]?.split( /^\[/m )[ 0 ];
					const name = section?.match( /^Name=(.+)$/m )?.[ 1 ].trim();
					if ( name ) return identifyBrowser( name );
				} catch {
					continue;
				}
			}
		}
	} catch {
		// Default-app lookup is optional; opening still follows the OS association.
	}
	return null;
}
