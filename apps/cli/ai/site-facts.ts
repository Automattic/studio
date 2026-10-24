import { activePluginsFact, comingSoonFact } from 'cli/ai/plugins';
import { savedCopiesFact } from 'cli/ai/saved-copies';
import { readWordPressSite, type WordPressSite } from 'cli/ai/site-database';
import { activeThemeFact } from 'cli/ai/themes';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

// Facts about a local site, read from its own files and database, one line
// each. They are what the agent would otherwise look up before acting, stated
// in the Active site section and in tool results (result-notes.ts), the same
// for Studio Code and MCP agents.
//
// A fact is a function of the site, owned by the module that knows that part
// of WordPress; it returns undefined when it has nothing to state. Add one by
// adding it here, in the order the facts read.
export type SiteFact = (
	site: WordPressSite
) => string | undefined | Promise< string | undefined >;

async function wordPressVersionFact( site: WordPressSite ): Promise< string | undefined > {
	const version = await getWordPressVersionFromInstallation( site.root );
	return version ? `WordPress ${ version }.` : undefined;
}

const SITE_FACTS: SiteFact[] = [
	wordPressVersionFact,
	activeThemeFact,
	activePluginsFact,
	savedCopiesFact,
	comingSoonFact,
];

/** The facts about the local site at `sitePath`. */
export function readSiteFacts( sitePath: string ): Promise< string[] > {
	return readWordPressSite( sitePath, async ( site ) =>
		( await Promise.all( SITE_FACTS.map( ( fact ) => fact( site ) ) ) ).filter(
			( fact ): fact is string => Boolean( fact )
		)
	);
}

/**
 * Facts about the active site for the Active site section. A WordPress.com
 * site's own server states what its plan and the user's role allow.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	return site && ! site.remote ? readSiteFacts( site.path ) : [];
}
