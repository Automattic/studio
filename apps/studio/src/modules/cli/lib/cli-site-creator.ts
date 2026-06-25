import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { buildSiteCreateArgs, type SiteCreateOptions } from '@studio/common/sites/create';
import { z } from 'zod';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from './execute-command';

const cliEventSchema = z.discriminatedUnion( 'action', [
	z.object( {
		action: z.enum( SiteCommandLoggerAction ),
		status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
		message: z.string(),
	} ),
	z.object( {
		action: z.literal( 'keyValuePair' ),
		key: z.enum( [ 'id', 'running', 'port' ] ),
		value: z.string(),
	} ),
] );

interface CreateSiteResult {
	id: string;
	port: number;
	running: boolean;
}

export type CreateSiteOptions = SiteCreateOptions;

export async function createSiteViaCli( options: CreateSiteOptions ): Promise< CreateSiteResult > {
	const { args, cleanup } = buildSiteCreateArgs( options );
	const siteId = options.siteId;

	return new Promise( ( resolve, reject ) => {
		const result: Partial< CreateSiteResult > = {};
		const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: siteId } );

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
				} else if ( key === 'port' ) {
					const parsedPort = Number.parseInt( value, 10 );
					if ( Number.isFinite( parsedPort ) && parsedPort > 0 ) {
						result.port = parsedPort;
					}
				} else if ( key === 'running' ) {
					result.running = value === 'true';
				}
			} else if ( parsed.data.status === 'inprogress' && siteId ) {
				void sendIpcEventToRenderer( 'on-site-create-progress', {
					siteId,
					message: parsed.data.message,
				} );
			}
		} );

		emitter.on( 'success', () => {
			cleanup();
			if ( ! result.id ) {
				reject( new Error( 'CLI create site succeeded but no site ID received' ) );
				return;
			}
			if ( ! result.port ) {
				reject( new Error( 'CLI create site succeeded but no port received' ) );
				return;
			}
			resolve( { id: result.id, port: result.port, running: result.running ?? false } );
		} );

		emitter.on( 'failure', ( { error } ) => {
			cleanup();
			error.baseMessage = 'Failed to create site';
			reject( error );
		} );

		emitter.on( 'error', ( { error } ) => {
			cleanup();
			reject( error );
		} );
	} );
}
