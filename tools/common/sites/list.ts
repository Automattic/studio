import { z } from 'zod';
import { siteListItemSchema, type SiteListItem } from '@studio/common/lib/cli-events';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

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

/** List the user's local sites via the Studio CLI. */
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
