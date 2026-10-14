import { siteListSchema, type SiteListItem } from '@studio/common/lib/cli-events';
import { runCliCommand, type ExecuteCliCommand } from '@studio/common/lib/cli-process';

/** List the user's local sites via the Studio CLI. */
export function listSites( execute: ExecuteCliCommand ): Promise< SiteListItem[] > {
	return runCliCommand( execute, [ 'site', 'list', '--format', 'json' ], siteListSchema );
}
