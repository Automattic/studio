import { readFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite, type WordPressSite } from '@studio/agent/node/site-database';

// Whether WordPress updates a theme, and so overwrites changes to its files.
// WordPress's last update check (wp_update_themes() in wp-includes/update.php)
// stores in the update_themes transient the themes it checked and those it
// found an update source for: WordPress.org, or the theme's Update URI. A
// theme installed since that check is asked of WordPress.org the way
// wp_update_themes() asks, by slug and version.

type Keyed = Record< string, unknown > | undefined;
type UpdateCheck = Record< 'checked' | 'response' | 'no_update', Keyed > | undefined;

function isUpdated( site: WordPressSite, theme: string ): boolean {
	const updates = site.option( '_site_transient_update_themes' ) as UpdateCheck;
	return theme in ( updates?.response ?? {} ) || theme in ( updates?.no_update ?? {} );
}

const UPDATE_CHECK_URL = 'https://api.wordpress.org/themes/update-check/1.1/';
const asked = new Map< string, Promise< boolean > >();

/** A header of a theme's style.css, read as get_file_data() reads it. */
export async function readThemeHeader(
	root: string,
	theme: string,
	header: string
): Promise< string > {
	const css = await readFile( path.join( root, 'wp-content/themes', theme, 'style.css' ), 'utf8' );
	return css.match( new RegExp( `^[ \\t/*#@]*${ header }:(.*)$`, 'im' ) )?.[ 1 ].trim() ?? '';
}

// One answer per theme release; an unanswered check is asked again.
function askWordPressOrg( theme: string, version: string, updateUri: string ): Promise< boolean > {
	const key = `${ theme }@${ version } ${ updateUri }`;
	let answer = asked.get( key );
	if ( ! answer ) {
		answer = fetch( UPDATE_CHECK_URL, {
			method: 'POST',
			body: new URLSearchParams( {
				themes: JSON.stringify( {
					themes: { [ theme ]: { Version: version, UpdateURI: updateUri } },
				} ),
			} ),
		} )
			.then( ( response ) => ( response.ok ? response.json() : Promise.reject() ) )
			.then(
				( body: { themes?: Keyed; no_update?: Keyed } ) =>
					theme in ( body.themes ?? {} ) || theme in ( body.no_update ?? {} )
			);
		answer.catch( () => asked.delete( key ) );
		asked.set( key, answer );
	}
	return answer.catch( () => false );
}

/**
 * Whether a theme update would overwrite changes to this theme's files. A
 * folder with no style.css is no theme WordPress has (WP_Theme's
 * theme_no_stylesheet error, in wp-includes/class-wp-theme.php), so no update
 * check sends it.
 */
export async function isUpdatableTheme( root: string, theme: string ): Promise< boolean > {
	const checked = await readWordPressSite( root, ( site ) => {
		const updates = site.option( '_site_transient_update_themes' ) as UpdateCheck;
		return theme in ( updates?.checked ?? {} ) ? isUpdated( site, theme ) : undefined;
	} );
	if ( checked !== undefined ) {
		return checked;
	}
	const version = await readThemeHeader( root, theme, 'Version' ).catch( () => undefined );
	return version === undefined
		? false
		: askWordPressOrg(
				theme,
				version,
				await readThemeHeader( root, theme, 'Update URI' ).catch( () => '' )
		  );
}

const INFO_URL = 'https://api.wordpress.org/themes/info/1.2/';
const released = new Map< string, Promise< { name: string; version: string } | undefined > >();

function wordPressOrgTheme( theme: string ) {
	let answer = released.get( theme );
	if ( ! answer ) {
		answer = fetch(
			`${ INFO_URL }?${ new URLSearchParams( {
				action: 'theme_information',
				'request[slug]': theme,
			} ) }`
		)
			.then( ( response ) => ( response.ok ? response.json() : Promise.reject() ) )
			.then( ( body: { name?: unknown; version?: unknown } ) =>
				typeof body.name === 'string'
					? { name: body.name, version: String( body.version ?? '' ) }
					: undefined
			);
		answer.catch( () => released.delete( theme ) );
		released.set( theme, answer );
	}
	return answer.catch( () => undefined );
}

/**
 * WordPress.org's theme of a theme's folder name, of a theme WordPress
 * updates (isUpdatableTheme()), when it is another theme: its style.css names
 * another theme than WordPress.org's. WordPress checks for theme updates by
 * folder name (wp_update_themes() in wp-includes/update.php).
 */
export async function wordPressOrgNamesake(
	root: string,
	theme: string
): Promise< { name: string; version: string; own: string } | undefined > {
	const own = await readThemeHeader( root, theme, 'Theme Name' ).catch( () => '' );
	const release = own ? await wordPressOrgTheme( theme ) : undefined;
	return release && release.name !== own ? { ...release, own } : undefined;
}

/** What WordPress does to a theme whose folder name is WordPress.org's other theme. */
export function namesakeProblem(
	theme: string,
	{ name, version, own }: { name: string; version: string; own: string }
): string {
	return `The theme in ${ theme }/ is "${ own }", and WordPress.org's theme ${ theme } is "${ name }": WordPress checks for theme updates by folder name and offers "${ name }" ${ version } as this theme's update (wp_update_themes() in wp-includes/update.php), which replaces its files with that theme's (Theme_Upgrader::upgrade() in wp-admin/includes/class-theme-upgrader.php). WordPress.org's check skips a theme whose style.css names an \`Update URI\` header (WP_Theme, since WordPress 6.1) other than WordPress.org. Give the theme an \`Update URI\` header, its own URL or \`false\`, or a folder name no WordPress.org theme has.`;
}

/**
 * The active theme, then its parent when it is a child theme: the stylesheet
 * and template options WordPress loads the theme by.
 */
export function activeThemes( site: WordPressSite ): string[] {
	return [ ...new Set( [ site.option( 'stylesheet' ), site.option( 'template' ) ] ) ].filter(
		( theme ): theme is string => typeof theme === 'string' && theme !== ''
	);
}

/** Site fact: the active theme, its parent, and which of them WordPress updates. */
export function activeThemeFact( site: WordPressSite ): string | undefined {
	const [ stylesheet, parent ] = activeThemes( site );
	if ( ! stylesheet ) {
		return undefined;
	}
	const describe = ( theme: string ) =>
		isUpdated( site, theme ) ? `${ theme }, which WordPress updates` : theme;
	return parent
		? `Active theme: ${ describe( stylesheet ) }; a child theme of ${ describe( parent ) }.`
		: `Active theme: ${ describe( stylesheet ) }.`;
}
