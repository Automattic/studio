/**
 * The styles WordPress resolves for a site after a call changed what it merges
 * them from by any route: the active theme's or its parent's theme.json, by
 * any tool or script, or the Global Styles post WordPress
 * reads for the theme, by WP-CLI, REST or PHP
 * (WP_Theme_JSON_Resolver::get_merged_data()). Studio states them as it does
 * after it saves the workspace copy of Global Styles (describeSavedGlobalStyles()
 * in global-styles.ts), without what the call changed of them, which only the
 * styles before it would tell; a call whose copy save stated them is not
 * stated again, nor one whose only change is a fix Studio saved, which its
 * note states (studio-file-changes.ts).
 */
import path from 'path';
import {
	describeSavedGlobalStyles,
	resolveGlobalStyles,
	resolvedStylesStated,
	themeGlobalStyles,
} from '@studio/agent/node/global-styles';
import { hash } from '@studio/agent/node/post-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { changedByStudio, fileVersion } from '@studio/agent/node/studio-file-changes';
import { activeThemes, themesDir } from '@studio/agent/node/themes';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

const POST = 'post ';
const FILE = 'file ';
const THEMES = 'themes';

// The theme's JSON WordPress merges styles from. A style variation in its
// styles/ folder applies only once the Global Styles post names it, which a
// change of that post states.
const THEME_JSON = 'theme.json';

// Holds styles or settings, as a post core makes on a read, holding neither, does not.
function holdsStyles( content: string ): boolean {
	try {
		const data = JSON.parse( content ) as { settings?: object; styles?: object };
		return Boolean(
			Object.keys( data?.settings ?? {} ).length || Object.keys( data?.styles ?? {} ).length
		);
	} catch {
		return Boolean( content.trim() );
	}
}

export const resolvedStyles: SiteChangeSource = {
	name: 'resolved styles',
	async read( sitePath ) {
		const { themes, post } = await readWordPressSite( sitePath, ( site ) => {
			const active = activeThemes( site );
			const saved = active[ 0 ] ? themeGlobalStyles( site, active[ 0 ] ) : undefined;
			return { themes: active, post: saved };
		} );
		const versions: Versions = { [ THEMES ]: themes.join( ' ' ) };
		// As post copies version it, so a copy save's statement is known as this one.
		if ( post && holdsStyles( post.content ) ) {
			versions[ `${ POST }${ post.id }` ] = `${ post.modified } ${ hash( post.content ) }`;
		}
		await Promise.all(
			themes.map( async ( theme ) => {
				const version = await fileVersion( path.join( themesDir( sitePath, theme ), THEME_JSON ) );
				if ( version ) {
					versions[ `${ FILE }${ theme }/${ THEME_JSON }` ] = version;
				}
			} )
		);
		return versions;
	},
	async check( site, before, after, host ) {
		const changed = [ ...new Set( [ ...Object.keys( before ), ...Object.keys( after ) ] ) ]
			.filter( ( key ) => before[ key ] !== after[ key ] )
			// A fix Studio saved states its own change.
			.filter(
				( key ) =>
					! key.startsWith( FILE ) ||
					! changedByStudio(
						path.join(
							themesDir( site.path, key.slice( FILE.length ).split( '/' )[ 0 ] ),
							THEME_JSON
						),
						before[ key ] ?? '',
						after[ key ] ?? ''
					)
			)
			.sort();
		// Another theme activated is not a change to what this one merges.
		if ( ! changed.length || changed.includes( THEMES ) ) {
			return { reports: [] };
		}
		// A save of the copy this call stated them, with the post as it is now.
		const post = changed.find( ( key ) => key.startsWith( POST ) && after[ key ] );
		if ( post && resolvedStylesStated( site.path, after[ post ] ) ) {
			return { reports: [] };
		}
		const described = await resolveGlobalStyles( host, site )
			.then( describeSavedGlobalStyles )
			.catch( () => undefined );
		if ( ! described?.summary && ! described?.problems.length ) {
			return { reports: [] };
		}
		const names = changed.map( ( key ) =>
			key.startsWith( POST )
				? `Global Styles post ${ key.slice( POST.length ) }`
				: key.slice( FILE.length )
		);
		return {
			reports: [
				{
					key: 'resolved styles',
					summary:
						described.summary &&
						`This call changed ${ names.join( ', ' ) }. ${ described.summary }`,
					problem: described.problems.length ? described.problems.join( '\n' ) : undefined,
				},
			],
		};
	},
};
