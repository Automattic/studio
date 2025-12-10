import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeCliCommand } from './execute-command';
import type { Blueprint } from '@wp-playground/blueprints';

export interface CreateSiteResult {
	site: {
		id: string;
		name: string;
		path: string;
		adminPassword?: string;
		port: number;
		phpVersion: string;
		running: boolean;
		url?: string;
		isWpAutoUpdating?: boolean;
		customDomain?: string;
		enableHttps?: boolean;
	};
}

export interface CreateSiteOptions {
	path: string;
	name?: string;
	wpVersion?: string;
	phpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	blueprint?: Blueprint;
	noStart?: boolean;
}

export async function createSiteViaCli( options: CreateSiteOptions ): Promise< CreateSiteResult > {
	const args = buildCliArgs( options );

	let blueprintTempPath: string | undefined;
	if ( options.blueprint ) {
		blueprintTempPath = path.join( os.tmpdir(), `studio-blueprint-${ Date.now() }.json` );
		fs.writeFileSync( blueprintTempPath, JSON.stringify( options.blueprint ) );
		args.push( '--blueprint', blueprintTempPath );
	}

	return new Promise( ( resolve, reject ) => {
		let siteResult: CreateSiteResult | null = null;
		let lastErrorMessage: string | null = null;

		const [ emitter ] = executeCliCommand( args );

		emitter.on( 'data', ( { data } ) => {
			if ( data && typeof data === 'object' ) {
				// Capture result message
				if ( 'action' in data && data.action === 'result' && 'site' in data ) {
					siteResult = { site: data.site as CreateSiteResult[ 'site' ] };
				}
				// Capture error messages from CLI Logger
				if ( 'status' in data && data.status === 'fail' && 'message' in data ) {
					lastErrorMessage = String( data.message );
				}
			}
		} );

		emitter.on( 'success', () => {
			cleanupTempFile( blueprintTempPath );
			if ( siteResult ) {
				resolve( siteResult );
			} else {
				reject( new Error( 'CLI create site succeeded but no result received' ) );
			}
		} );

		emitter.on( 'failure', () => {
			cleanupTempFile( blueprintTempPath );
			reject( new Error( lastErrorMessage || 'CLI create site failed' ) );
		} );

		emitter.on( 'error', ( { error } ) => {
			cleanupTempFile( blueprintTempPath );
			reject( error );
		} );
	} );
}

function buildCliArgs( options: CreateSiteOptions ): string[] {
	const args = [ 'site', 'create', '--path', options.path, '--skip-browser' ];

	if ( options.name ) {
		args.push( '--name', options.name );
	}

	if ( options.wpVersion ) {
		args.push( '--wp', options.wpVersion );
	}

	if ( options.phpVersion ) {
		args.push( '--php', options.phpVersion );
	}

	if ( options.customDomain ) {
		args.push( '--domain', options.customDomain );
	}

	if ( options.enableHttps ) {
		args.push( '--https' );
	}

	if ( options.noStart ) {
		args.push( '--no-start' );
	}

	return args;
}

function cleanupTempFile( filePath: string | undefined ): void {
	if ( filePath && fs.existsSync( filePath ) ) {
		try {
			fs.unlinkSync( filePath );
		} catch ( error ) {
			console.error( 'Failed to clean up temp blueprint file:', error );
		}
	}
}
