import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { executeCliCommand } from './execute-command';
import type { Blueprint } from '@wp-playground/blueprints';

const keyValuePairSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.enum( [ 'id', 'running' ] ),
	value: z.string(),
} );

const errorMessageSchema = z.object( {
	status: z.literal( 'fail' ),
	message: z.string(),
} );

export interface CreateSiteResult {
	id: string;
	running: boolean;
}

export interface CreateSiteOptions {
	path: string;
	name?: string;
	wpVersion?: string;
	phpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	siteId?: string;
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
		const result: Partial< CreateSiteResult > = {};
		let lastErrorMessage: string | null = null;

		const [ emitter ] = executeCliCommand( args );

		emitter.on( 'data', ( { data } ) => {
			const keyValueParsed = keyValuePairSchema.safeParse( data );
			if ( keyValueParsed.success ) {
				const { key, value } = keyValueParsed.data;
				if ( key === 'id' ) {
					result.id = value;
				} else if ( key === 'running' ) {
					result.running = value === 'true';
				}
				return;
			}

			const errorParsed = errorMessageSchema.safeParse( data );
			if ( errorParsed.success ) {
				lastErrorMessage = errorParsed.data.message;
			}
		} );

		emitter.on( 'success', () => {
			cleanupTempFile( blueprintTempPath );
			if ( result.id ) {
				resolve( { id: result.id, running: result.running ?? false } );
			} else {
				reject( new Error( 'CLI create site succeeded but no site ID received' ) );
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
