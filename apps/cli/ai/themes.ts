import { readWordPressSite, type WordPressSite } from 'cli/ai/site-database';

// Whether WordPress updates a theme, and so overwrites changes to its files.
// WordPress's last update check (wp_update_themes() in wp-includes/update.php)
// stores in the update_themes transient the themes it checked and those it
// found an update source for: WordPress.org, or the theme's Update URI. A
// theme it has not checked yet, such as one created or installed since, is not
// known to be updated until WordPress next looks for updates.

type Keyed = Record< string, unknown > | undefined;

function isUpdated( site: WordPressSite, theme: string ): boolean {
	const updates = site.option( '_site_transient_update_themes' ) as
		| Record< 'response' | 'no_update', Keyed >
		| undefined;
	return theme in ( updates?.response ?? {} ) || theme in ( updates?.no_update ?? {} );
}

/** Whether a theme update would overwrite changes to this theme's files. */
export function isUpdatableTheme( root: string, theme: string ): Promise< boolean > {
	return readWordPressSite( root, ( site ) => isUpdated( site, theme ) );
}

/** Site fact: the active theme, its parent, and which of them WordPress updates. */
export function activeThemeFact( site: WordPressSite ): string | undefined {
	const stylesheet = site.option( 'stylesheet' );
	const template = site.option( 'template' );
	if ( typeof stylesheet !== 'string' ) {
		return undefined;
	}
	const describe = ( theme: string ) =>
		isUpdated( site, theme ) ? `${ theme }, which WordPress updates` : theme;
	return typeof template === 'string' && template !== stylesheet
		? `Active theme: ${ describe( stylesheet ) }; a child theme of ${ describe( template ) }.`
		: `Active theme: ${ describe( stylesheet ) }.`;
}
