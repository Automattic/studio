import { readFile } from 'fs/promises';
import path from 'path';
import { readWordPressSite, type WordPressSite } from 'cli/ai/site-database';

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

/** The Version a theme's style.css header names. */
export function readThemeVersion( root: string, theme: string ): Promise< string > {
	return readThemeHeader( root, theme, 'Version' );
}

// One answer per theme release; an unanswered check is asked again.
function askWordPressOrg( theme: string, version: string ): Promise< boolean > {
	const key = `${ theme }@${ version }`;
	let answer = asked.get( key );
	if ( ! answer ) {
		answer = fetch( UPDATE_CHECK_URL, {
			method: 'POST',
			body: new URLSearchParams( {
				themes: JSON.stringify( { themes: { [ theme ]: { Version: version } } } ),
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

/** Whether a theme update would overwrite changes to this theme's files. */
export async function isUpdatableTheme( root: string, theme: string ): Promise< boolean > {
	const checked = await readWordPressSite( root, ( site ) => {
		const updates = site.option( '_site_transient_update_themes' ) as UpdateCheck;
		return theme in ( updates?.checked ?? {} ) ? isUpdated( site, theme ) : undefined;
	} );
	return (
		checked ?? askWordPressOrg( theme, await readThemeVersion( root, theme ).catch( () => '' ) )
	);
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
