import { StaticAgentRuns } from './agent';
import { StaticSites } from './sites';
import { WpcomAuth } from './wpcom-auth';
import { WpcomServices } from './wpcom-services';

export { AGENT_INSTRUCTIONS_ENABLED_KEY, AGENT_INSTRUCTIONS_KEY } from './agent';
export {
	getSiteOrigin,
	loadBlueprintBundle,
	loadPlaygroundClient,
	loadSiteOrigin,
} from './playground';
export {
	exportDatabaseSql,
	exportSiteZip,
	getPathSize,
	listFileTree,
	readWordPressVersion,
} from './site-data';
export { connectPreviewFrame, withSitePage } from './site-page';
export { kvGet, kvSet, kvUpdate } from './store';
export { completeRedirectSignIn } from './wpcom-auth';
export type { BlueprintBundle } from '@wp-playground/client';

/**
 * Studio on the web's backend, running in the page: sites in WordPress
 * Playground, the WordPress.com account and its services, and Studio Code's
 * runs. The static connector in `apps/ui` maps the UI's calls onto it.
 */
export function createStaticBackend( deps: {
	// A file the user attached to the chat, by the path its prompt names.
	readAttachment( path: string ): File | undefined;
	// Saves a file to the user's computer through the browser.
	download( data: BlobPart, filename: string, type: string ): void;
} ) {
	const sites = new StaticSites();
	const auth = new WpcomAuth();
	const wpcom = new WpcomServices( auth, sites );
	const agent = new StaticAgentRuns( { sites, auth, wpcom, ...deps } );
	return { sites, auth, wpcom, agent };
}
