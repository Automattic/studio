import path from 'path';
import { DEBUG_LOG_RELATIVE_PATH } from '@studio/common/constants';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { siteCodeFact } from '@studio/agent/node/admin-capabilities';
import { homepageFact } from '@studio/agent/node/front-page-template';
import {
	activePluginsFact,
	comingSoonFact,
	jetpackFact,
	wooCommerceFact,
} from '@studio/agent/node/plugins';
import { postCopiesFact } from '@studio/agent/node/post-copies';
import { savedCopiesFact } from '@studio/agent/node/saved-copies';
import { readWordPressSite, type WordPressSite } from '@studio/agent/node/site-database';
import { themePresetsFact } from '@studio/agent/node/theme-presets';
import { activeThemeFact } from '@studio/agent/node/themes';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { SiteInfo } from '@studio/agent/node/types';

// Facts about a local site, read from its own files and database, one line
// each. They are what the agent would otherwise look up before acting, stated
// in the Active site section and in tool results (site-notes.ts), the same
// for Studio Code and MCP agents.
//
// A fact is a function of the site, owned by the module that knows that part
// of WordPress; it returns a line, or several, and nothing when it has nothing
// to state. Add one by adding it here, in the order the facts read. `host`
// is the app the agent runs in, for what Studio knows of the site.
type FactLines = string | string[] | undefined;
type SiteFact = ( site: WordPressSite, host: StudioAgentHost ) => FactLines | Promise< FactLines >;

function wordPressVersionFact( site: WordPressSite ): string | undefined {
	const version = getWordPressVersion( site.root );
	return version !== '-' ? `WordPress ${ version }.` : undefined;
}

// Studio serves the site at this address and defines it as WP_HOME before
// WordPress boots (lib/native-php/site-setup.ts), so home_url() returns it;
// whether it serves it now is what a request to it, or a screenshot, needs.
async function siteAddressFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	const studioSite = await host.sites.findByFolder( site.root );
	if ( ! studioSite ) {
		return undefined;
	}
	const serving = await host.sites.isRunning( studioSite ).catch( () => undefined );
	const state =
		serving === undefined
			? ''
			: serving
			? ' Studio is serving the site there now.'
			: ' The site is stopped: site_start serves it.';
	return `Address: ${ studioSite.url } (home_url()).${ state }`;
}

// `studio wp` runs WP-CLI on the Studio site holding the folder it runs in
// (getSiteContainingFolder() in cli/commands/wp.ts), on Studio's PHP and with the
// site's SQLite database, which WordPress opens through wp-content/db.php.
async function wpCliFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	return ( await host.sites.findByFolder( site.root ) )
		? `WP-CLI: \`studio wp <command>\` run in ${ site.root } runs it on this site, on Studio's PHP and with its SQLite database (wp-content/db.php).`
		: undefined;
}

// Studio defines WP_DEBUG and WP_DEBUG_LOG in wp-config.php from the site's
// debug log setting each time the site starts (ensureWpConfig() in
// lib/native-php/site-setup.ts), and wp_debug_mode() (wp-includes/load.php)
// logs PHP errors to wp-content/debug.log when both are true.
async function errorLogFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	const studioSite = await host.sites.findByFolder( site.root );
	if ( ! studioSite ) {
		return undefined;
	}
	const log = path.join( site.root, DEBUG_LOG_RELATIVE_PATH );
	return studioSite.enableDebugLog
		? `PHP errors: WordPress logs them to ${ log } (WP_DEBUG_LOG, wp_debug_mode() in wp-includes/load.php).`
		: `PHP errors: WordPress logs none, as WP_DEBUG_LOG is off (wp_debug_mode() in wp-includes/load.php). \`studio config set --debug-log\` run in ${ site.root } turns it on and restarts the site, and WordPress then logs them to ${ log }; Studio defines WP_DEBUG and WP_DEBUG_LOG in wp-config.php from that setting each time the site starts.`;
}

// WordPress is installed once its options hold siteurl (is_blog_installed());
// Studio installs it the first time the site starts (installWordPress() in
// lib/native-php/site-setup.ts), so a site never started has no database yet.
function installedFact( site: WordPressSite ): string | undefined {
	return site.option( 'siteurl' ) === undefined
		? 'WordPress is not installed yet (is_blog_installed()): Studio installs it, with its database, when the site first starts (site_start).'
		: undefined;
}

const SITE_FACTS: SiteFact[] = [
	siteAddressFact,
	wpCliFact,
	errorLogFact,
	wordPressVersionFact,
	installedFact,
	activeThemeFact,
	themePresetsFact,
	homepageFact,
	postCopiesFact,
	activePluginsFact,
	jetpackFact,
	wooCommerceFact,
	siteCodeFact,
	savedCopiesFact,
	comingSoonFact,
];

/**
 * The facts about the local site at `sitePath`, by the fact that states them,
 * so a line that changes is known to replace the one it was.
 */
export function readSiteFacts( host: StudioAgentHost, sitePath: string ): Promise< string[][] > {
	return readWordPressSite( sitePath, ( site ) =>
		Promise.all(
			SITE_FACTS.map( async ( fact ) =>
				[ await fact( site, host ) ].flat().filter( ( line ): line is string => Boolean( line ) )
			)
		)
	);
}

/**
 * Facts about the active site for the Active site section. A WordPress.com
 * site's own server states what its plan and the user's role allow.
 */
export async function readActiveSiteFacts(
	host: StudioAgentHost,
	site?: SiteInfo | null
): Promise< string[][] > {
	if ( ! site ) {
		return [];
	}
	return site.remote
		? ( await host.remoteHosts[ site.remote.host ]?.sites?.facts( site ) ) ?? []
		: readSiteFacts( host, site.path );
}
