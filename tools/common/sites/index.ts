import { z } from 'zod';
import { siteListItemSchema, type SiteListItem } from '@studio/common/lib/cli-events';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

/**
 * Site operations, delegated to the Studio CLI.
 *
 * This is the shared body of logic the desktop app and the `studio ui` server
 * both use: each passes its {@link ExecuteCliCommand} (which knows the CLI
 * binary to fork), and the operations here are identical regardless of transport
 * (IPC vs REST). Taking the function rather than the whole runner keeps the
 * desktop's existing command mocks working.
 */

// The CLI's `site list --format json` reports the array over its IPC channel as
// a `keyValuePair` ("sites" → JSON string), the same envelope the desktop reads.
const siteListKeyValueSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'sites' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) as unknown )
		.pipe( z.array( siteListItemSchema ) ),
} );

export function listSites( execute: ExecuteCliCommand ): Promise< SiteListItem[] > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute( [ 'site', 'list', '--format', 'json' ], {
			output: 'capture',
		} );

		emitter.on( 'data', ( { data } ) => {
			const parsed = siteListKeyValueSchema.safeParse( data );
			if ( parsed.success ) {
				resolve( parsed.data.value );
			}
		} );

		// No `keyValuePair` arrived before exit — treat as an empty list.
		emitter.on( 'success', () => resolve( [] ) );
		emitter.on( 'failure', ( { error } ) => reject( error ) );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export function startSite( execute: ExecuteCliCommand, sitePath: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute(
			[ 'site', 'start', '--path', sitePath, '--skip-browser', '--skip-log-details' ],
			{ output: 'capture' }
		);
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to start site';
			reject( error );
		} );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}

export function stopSite( execute: ExecuteCliCommand, sitePath: string ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = execute( [ 'site', 'stop', '--path', sitePath ], {
			output: 'capture',
		} );
		emitter.on( 'success', () => resolve() );
		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to stop site';
			reject( error );
		} );
		emitter.on( 'error', ( { error } ) => reject( error ) );
	} );
}
