import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { __, sprintf } from '@wordpress/i18n';
import { readAppConfig } from '@studio/common/lib/app-config';
import { browserConfig, SUPPORTED_BROWSERS, type SupportedBrowser } from './browser';

export async function readPreferredBrowser(): Promise< SupportedBrowser | null > {
	const { preferredBrowser } = await readAppConfig();
	return SUPPORTED_BROWSERS.includes( preferredBrowser as SupportedBrowser )
		? ( preferredBrowser as SupportedBrowser )
		: null;
}

export function getBrowserPath( browser: SupportedBrowser ): string | null {
	const config = browserConfig[ browser ];
	if ( process.platform === 'darwin' ) {
		return (
			[ '/Applications', path.join( os.homedir(), 'Applications' ), '/System/Applications' ]
				.map( ( dir ) => path.join( dir, config.macOSApp ) )
				.find( ( file ) => fs.existsSync( file ) ) ?? null
		);
	}
	if ( process.platform === 'win32' ) {
		if ( ! config.winPath ) {
			return null;
		}
		return (
			[ process.env.ProgramFiles, process.env[ 'ProgramFiles(x86)' ], process.env.LOCALAPPDATA ]
				.filter( ( dir ): dir is string => !! dir )
				.map( ( dir ) => path.win32.join( dir, config.winPath ) )
				.find( ( file ) => fs.existsSync( file ) ) ?? null
		);
	}
	return (
		config.linuxCommands
			.map( ( command ) => {
				for ( const dir of ( process.env.PATH ?? '' ).split( path.delimiter ).filter( Boolean ) ) {
					const candidate = path.join( dir, command );
					try {
						if ( fs.statSync( candidate ).isFile() ) {
							fs.accessSync( candidate, fs.constants.X_OK );
							return candidate;
						}
					} catch {
						continue;
					}
				}
				return null;
			} )
			.find( ( file ) => file !== null ) ?? null
	);
}

export function detectInstalledBrowsers(): Record< SupportedBrowser, boolean > {
	return Object.fromEntries(
		SUPPORTED_BROWSERS.map( ( browser ) => [ browser, !! getBrowserPath( browser ) ] )
	) as Record< SupportedBrowser, boolean >;
}

export async function openSiteInBrowser(
	url: string,
	openDefault: ( url: string ) => Promise< unknown >
): Promise< void > {
	const parsed = new URL( url );
	if ( ! [ 'http:', 'https:' ].includes( parsed.protocol ) ) {
		throw new Error( 'Unsupported browser URL' );
	}
	const browser = await readPreferredBrowser();
	if ( ! browser ) {
		await openDefault( parsed.toString() );
		return;
	}
	const executable = getBrowserPath( browser );
	if ( ! executable ) {
		throw new Error(
			sprintf(
				__( '%s is no longer installed. Choose another browser in Settings.' ),
				browserConfig[ browser ].name
			)
		);
	}
	const command = process.platform === 'darwin' ? 'open' : executable;
	const args =
		process.platform === 'darwin' ? [ '-a', executable, parsed.toString() ] : [ parsed.toString() ];
	await new Promise< void >( ( resolve, reject ) => {
		const child = spawn( command, args, { detached: true, stdio: 'ignore' } );
		child.once( 'error', reject );
		if ( process.platform === 'darwin' ) {
			child.once( 'exit', ( code ) =>
				code === 0 ? resolve() : reject( new Error( __( 'Failed to open browser' ) ) )
			);
		} else {
			child.once( 'spawn', () => {
				child.unref();
				resolve();
			} );
		}
	} );
}
