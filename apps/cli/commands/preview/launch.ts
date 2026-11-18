import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { __, sprintf } from '@wordpress/i18n';
import { openBrowser } from 'cli/lib/browser';
import { wpcomPreviews } from 'cli/lib/preview-sites';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

/**
 * Where the owner buys a preview site, which makes it their live site: the link WordPress.com gives
 * for it. A preview that was bought, ended or deleted has none, and neither does a preview of changes
 * to a live site, which is published there instead.
 */
export async function getPreviewLaunchUrl( host: string ): Promise< string > {
	const token = await requireAuthToken();
	const snapshot = ( await getSnapshotsFromConfig( token.id ) ).find(
		( item ) => normalizeHostname( item.url ) === host
	);
	if ( ! snapshot ) {
		throw new LoggerError( __( 'Preview site not found' ), undefined, 'not_found' );
	}
	const launchUrl = ( await wpcomPreviews.list( { token: token.accessToken } ) ).find(
		( preview ) => preview.id === snapshot.atomicSiteId
	)?.launchUrl;
	if ( ! launchUrl ) {
		throw new LoggerError(
			__(
				'This preview site can’t be made live: it was bought, ended or deleted, or it shows changes to a live site.'
			),
			undefined,
			'not_launchable'
		);
	}
	return launchUrl;
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'launch <host>',
		describe: __( 'Make a preview site your live site' ),
		builder: ( yargs ) =>
			yargs
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site' ),
					demandOption: true,
				} )
				.option( 'path', { hidden: true } ),
		handler: async ( argv ) => {
			const logger = new Logger< string >();
			try {
				const launchUrl = await getPreviewLaunchUrl( normalizeHostname( argv.host ) );
				logger.reportSuccess(
					/* translators: %s: link to WordPress.com's checkout for the preview site */
					sprintf( __( 'Choose a plan to make it live: %s' ), launchUrl )
				);
				logger.reportResult( { launchUrl } );
				await openBrowser( launchUrl ).catch( () => undefined );
			} catch ( error ) {
				logger.reportError(
					error instanceof LoggerError
						? error
						: new LoggerError( __( 'Failed to find the preview site’s launch link' ), error )
				);
				process.exit( 1 );
			}
		},
	} );
};
