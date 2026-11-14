import { StaticAgentRuns } from './agent';
import { StaticSites } from './sites';
import { WpcomAuth } from './wpcom-auth';
import { WpcomServices } from './wpcom-services';
import type { StaticAgentPage } from './agent/host';

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
	playgroundSiteFiles,
	readActiveThemeSlug,
	readGlobalStyles,
	readWordPressVersion,
} from './site-data';
export { capturePreviewRegion, connectPreviewFrame, withSitePage } from './site-page';
export { kvGet, kvSet, kvUpdate } from './store';
export { completeRedirectSignIn } from './wpcom-auth';
export type { BlueprintBundle } from '@wp-playground/client';

/**
 * Studio on the web's backend, running in the page: sites in WordPress
 * Playground, the WordPress.com account and its services, and Studio Code's
 * runs. The static connector in `apps/ui` maps the UI's calls onto it.
 */
export function createStaticBackend( {
	hidesAdminBarByDefault,
	...deps
}: StaticAgentPage & { hidesAdminBarByDefault: () => Promise< boolean > } ) {
	const sites = new StaticSites( hidesAdminBarByDefault );
	const auth = new WpcomAuth();
	const wpcom = new WpcomServices( auth, sites );
	const agent = new StaticAgentRuns( { sites, auth, wpcom, ...deps } );
	return { sites, auth, wpcom, agent };
}
