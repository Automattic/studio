import path from 'path';
import { DEBUG_LOG_RELATIVE_PATH } from '@studio/common/constants';
import { siteCodeFact } from 'cli/ai/admin-capabilities';
import { homepageFact } from 'cli/ai/front-page-template';
import { hostOf } from 'cli/ai/hosts';
import { activePluginsFact, comingSoonFact, jetpackFact, wooCommerceFact } from 'cli/ai/plugins';
import { postCopiesFact } from 'cli/ai/post-copies';
import { savedCopiesFact } from 'cli/ai/saved-copies';
import { readWordPressSite, type WordPressSite } from 'cli/ai/site-database';
import { themePresetsFact } from 'cli/ai/theme-presets';
import { activeThemeFact } from 'cli/ai/themes';
import { findSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

// Facts about a local site, read from its own files and database, one line
// each. They are what the agent would otherwise look up before acting, stated
// in the Active site section and in tool results (site-notes.ts), the same
// for Studio Code and MCP agents.
//
// A fact is a function of the site, owned by the module that knows that part
// of WordPress; it returns a line, or several, and nothing when it has nothing
// to state. Add one by adding it here, in the order the facts read.
type FactLines = string | string[] | undefined;
type SiteFact = ( site: WordPressSite ) => FactLines | Promise< FactLines >;

async function wordPressVersionFact( site: WordPressSite ): Promise< string | undefined > {
	const version = await getWordPressVersionFromInstallation( site.root );
	return version ? `WordPress ${ version }.` : undefined;
}

// Studio serves the site at this address and defines it as WP_HOME before
// WordPress boots (lib/native-php/site-setup.ts), so home_url() returns it.
async function siteAddressFact( site: WordPressSite ): Promise< string | undefined > {
	const studioSite = await findSiteByFolder( site.root );
	return studioSite ? `Address: ${ getSiteUrl( studioSite ) } (home_url()).` : undefined;
}

// `studio wp` runs WP-CLI on the Studio site holding the folder it runs in
// (getSiteContainingFolder() in cli/commands/wp.ts), on Studio's PHP and with the
// site's SQLite database, which WordPress opens through wp-content/db.php.
async function wpCliFact( site: WordPressSite ): Promise< string | undefined > {
	return ( await findSiteByFolder( site.root ) )
		? `WP-CLI: \`studio wp <command>\` run in ${ site.root } runs it on this site, on Studio's PHP and with its SQLite database (wp-content/db.php).`
		: undefined;
}

// Studio defines WP_DEBUG and WP_DEBUG_LOG in wp-config.php from the site's
// debug log setting each time the site starts (ensureWpConfig() in
// lib/native-php/site-setup.ts), and wp_debug_mode() (wp-includes/load.php)
// logs PHP errors to wp-content/debug.log when both are true.
async function errorLogFact( site: WordPressSite ): Promise< string | undefined > {
	const studioSite = await findSiteByFolder( site.root );
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
export function readSiteFacts( sitePath: string ): Promise< string[][] > {
	return readWordPressSite( sitePath, ( site ) =>
		Promise.all(
			SITE_FACTS.map( async ( fact ) =>
				[ await fact( site ) ].flat().filter( ( line ): line is string => Boolean( line ) )
			)
		)
	);
}

/**
 * Facts about the active site for the Active site section. A WordPress.com
 * site's own server states what its plan and the user's role allow.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[][] > {
	if ( ! site ) {
		return [];
	}
	return site.remote
		? ( await hostOf( site.remote ).sites?.facts( site ) ) ?? []
		: readSiteFacts( site.path );
}
