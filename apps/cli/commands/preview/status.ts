import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { __ } from '@wordpress/i18n';
import { findSiteById } from 'cli/lib/cli-config/sites';
import { getPreviewEditedAt } from 'cli/lib/preview-sites';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

/**
 * What changed since Studio last pushed the local site to a preview or pulled the preview into it.
 * Each is null when Studio can't tell: the preview has no local site, or was last synced before
 * Studio recorded versions.
 */
export type PreviewStatus = {
	localSiteId: string | null;
	localChanged: boolean | null;
	previewChanged: boolean | null;
};

export async function getPreviewStatus( host: string ): Promise< PreviewStatus > {
	const token = await requireAuthToken();
	const snapshot = ( await getSnapshotsFromConfig( token.id ) ).find(
		( item ) => normalizeHostname( item.url ) === host
	);
	if ( ! snapshot ) {
		throw new LoggerError( __( 'Preview site not found' ), undefined, 'not_found' );
	}
	const site = snapshot.localSiteId ? await findSiteById( snapshot.localSiteId ) : undefined;
	const localChanged =
		site && snapshot.versionId
			? ( await getSiteVersion( site.id, site.path ) ) !== snapshot.versionId
			: null;
	const previewChanged = snapshot.syncedAt
		? ( await getPreviewEditedAt( snapshot.atomicSiteId, token.accessToken ) ) > snapshot.syncedAt
		: null;
	return { localSiteId: site?.id ?? null, localChanged, previewChanged };
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'status <host>',
		describe: __( 'Show whether a preview site or its local site changed since they were synced' ),
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
				const status = await getPreviewStatus( normalizeHostname( argv.host ) );
				console.log( JSON.stringify( status ) );
				logger.reportResult( status );
			} catch ( error ) {
				logger.reportError(
					error instanceof LoggerError
						? error
						: new LoggerError( __( 'Failed to check the preview site' ), error )
				);
				process.exit( 1 );
			}
		},
	} );
};
