import { siteListItemSchema, type SiteListItem } from '@studio/common/lib/cli-events';
import { CliCommandError, runCliCommand } from '@studio/common/lib/cli-process';
import { buildSiteCreateArgs, type SiteCreateOptions } from '@studio/common/sites/create';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from './execute-command';

export type CreateSiteOptions = SiteCreateOptions;

export async function createSiteViaCli( options: CreateSiteOptions ): Promise< SiteListItem > {
	const { args, cleanup } = buildSiteCreateArgs( options );
	const siteId = options.siteId;

	try {
		return await runCliCommand( executeCliCommand, args, siteListItemSchema, {
			logPrefix: siteId,
			onProgress: ( message ) => {
				console.log( `${ siteId ? `[CLI - ${ siteId }]` : '[CLI]' } ${ message }` );
				if ( siteId ) {
					void sendIpcEventToRenderer( 'on-site-create-progress', { siteId, message } );
				}
			},
		} );
	} catch ( error ) {
		if ( error instanceof CliCommandError ) {
			error.baseMessage = 'Failed to create site';
		}
		throw error;
	} finally {
		cleanup();
	}
}
