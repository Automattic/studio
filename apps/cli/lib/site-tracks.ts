import { createSiteTracksPropsResolver } from '@studio/common/lib/site-tracks';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import type { Snapshot } from '@studio/common/types/snapshot';

export async function getSiteTracksProps(
	siteFolder: string,
	preview?: Pick< Snapshot, 'atomicSiteId' | 'userId' >
): Promise< { site_id?: string; preview_id?: string } > {
	return createSiteTracksPropsResolver( {
		lock: lockCliConfig,
		read: readCliConfig,
		save: saveCliConfig,
		unlock: unlockCliConfig,
	} )( { siteFolder }, preview );
}
