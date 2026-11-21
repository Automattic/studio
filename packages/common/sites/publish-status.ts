import { type SitesProviderId } from '@studio/providers';
import { z } from 'zod';
import { runCliCommand, type ExecuteCliCommand } from '@studio/common/lib/cli-process';
import { readSitePath } from './site-path';

const publishStatusSchema = z.object( { localChanged: z.boolean().nullable() } );
export type SitePublishStatus = z.infer< typeof publishStatusSchema >;

export async function getSitePublishStatus(
	execute: ExecuteCliCommand,
	siteId: string,
	remoteSiteId: string | number,
	provider: SitesProviderId = 'wpcom'
): Promise< SitePublishStatus > {
	if ( ! String( remoteSiteId ).trim() ) throw new Error( 'Invalid remote site ID' );
	const path = await readSitePath( siteId );
	if ( ! path ) throw new Error( 'Local site not found' );
	return runCliCommand(
		execute,
		[ '_publish-status', String( remoteSiteId ), '--provider', provider, '--path', path ],
		publishStatusSchema
	);
}
