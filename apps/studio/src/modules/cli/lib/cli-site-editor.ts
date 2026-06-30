import { SiteCommandLoggerAction } from '@studio/common/logger-actions';
import { buildSiteSetArgs, type EditSiteOptions } from '@studio/common/sites/edit';
import { z } from 'zod';
import { executeCliCommand } from './execute-command';

export type { EditSiteOptions };

const cliEventSchema = z.object( {
	action: z.enum( SiteCommandLoggerAction ),
	status: z.enum( [ 'inprogress', 'fail', 'success', 'warning' ] ),
	message: z.string(),
} );

export async function editSiteViaCli( options: EditSiteOptions ): Promise< void > {
	const args = buildSiteSetArgs( options );
	console.log( `[CLI Site Editor] Executing: studio ${ args.join( ' ' ) }` );

	return new Promise( ( resolve, reject ) => {
		const [ emitter ] = executeCliCommand( args, { output: 'capture', logPrefix: options.siteId } );

		emitter.on( 'data', ( { data } ) => {
			const parsed = cliEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			if ( parsed.data.status === 'inprogress' ) {
				console.log( `[CLI - ${ options.siteId }] ${ parsed.data.message }` );
			}
		} );

		emitter.on( 'success', () => {
			resolve();
		} );

		emitter.on( 'failure', ( { error } ) => {
			error.baseMessage = 'Failed to edit site';
			reject( error );
		} );

		emitter.on( 'error', ( { error } ) => {
			reject( error );
		} );
	} );
}
