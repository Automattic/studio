import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SiteCommandLoggerAction } from 'common/logger-actions';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from './execute-command';
import type { Blueprint } from '@wp-playground/blueprints';

const cliEventSchema = z.discriminatedUnion( 'action', [
	z.object( {
		action: z.nativeEnum( SiteCommandLoggerAction ),
		status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
		message: z.string(),
	} ),
	z.object( {
		action: z.literal( 'keyValuePair' ),
		key: z.enum( [ 'id', 'running' ] ),
		value: z.string(),
	} ),
] );

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
	const siteId = options.siteId;

	let blueprintTempPath: string | undefined;
	if ( options.blueprint ) {
		blueprintTempPath = path.join( os.tmpdir(), `studio-blueprint-${ Date.now() }.json` );
		fs.writeFileSync( blueprintTempPath, JSON.stringify( options.blueprint ) );
		args.push( '--blueprint', blueprintTempPath );
	}

	return new Promise( ( resolve, reject ) => {
		const result: Partial< CreateSiteResult > = {};
		let lastErrorMessage: string | null = null;

		const [ emitter ] = executeCliCommand( args, { mode: 'capture-stdio', logPrefix: siteId } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = cliEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			if ( parsed.data.action !== 'keyValuePair' && parsed.data.status === 'inprogress' ) {
				const prefix = siteId ? `[CLI - ${ siteId }]` : '[CLI]';
				console.log( `${ prefix } ${ parsed.data.message }` );
			}

			if ( parsed.data.action === 'keyValuePair' ) {
				const { key, value } = parsed.data;
				if ( key === 'id' ) {
					result.id = value;
				} else if ( key === 'running' ) {
					result.running = value === 'true';
				}
			} else if ( parsed.data.status === 'inprogress' && siteId ) {
				void sendIpcEventToRenderer( 'on-site-create-progress', {
					siteId,
					message: parsed.data.message,
				} );
			} else if ( parsed.data.status === 'fail' ) {
				lastErrorMessage = parsed.data.message;
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
