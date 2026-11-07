/**
 * The look of a site built on a theme WordPress updates. Such a theme ships one
 * look for every site that uses it; a site has a look of its own only where
 * WordPress keeps one: its Global Styles (WP_Theme_JSON_Resolver::get_user_data()),
 * templates and parts saved for the theme (get_block_templates()), or a theme
 * of its own. When a call gives a site a static front page, or a front page on
 * another theme, and the site has none of these, Studio says so on the result,
 * once, with where WordPress keeps a site's own look.
 */
import { readSavedCopies } from '@studio/agent/node/saved-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { themePresets } from '@studio/agent/node/theme-presets';
import { activeThemes, isUpdatableTheme, readThemeHeader } from '@studio/agent/node/themes';
import type { SiteChangeSource, Versions } from '@studio/agent/node/site-changes';

export const themeLook: SiteChangeSource = {
	name: 'theme-look',
	async read( sitePath ) {
		return readWordPressSite( sitePath, ( site ): Versions => {
			const [ theme ] = activeThemes( site );
			const front = Number( site.option( 'page_on_front' ) );
			// A front page on a theme, with nothing saved of the site's own.
			return theme &&
				site.option( 'show_on_front' ) === 'page' &&
				front &&
				! readSavedCopies( site ).length
				? { front: `page ${ front } on ${ theme }` }
				: {};
		} );
	},
	async check( site, before, after, host ) {
		if ( ! after.front || after.front === before.front ) {
			return { reports: [] };
		}
		const look = await readWordPressSite( site.path, async ( wp ) => {
			const [ theme ] = activeThemes( wp );
			if ( ! ( await isUpdatableTheme( site.path, theme ) ) ) {
				return undefined;
			}
			return {
				theme:
					( await readThemeHeader( site.path, theme, 'Theme Name' ).catch( () => '' ) ) || theme,
				front: Number( wp.option( 'page_on_front' ) ),
				variations: ( await themePresets( host, wp ) )?.styleVariations ?? [],
			};
		} );
		if ( ! look ) {
			return { reports: [] };
		}
		const { theme, front, variations } = look;
		const styles = variations.length
			? `, as the Site Editor's Styles saves them, a style variation of ${ theme }'s (${ variations.join(
					', '
			  ) }) or styles of the site's own`
			: '';
		return {
			reports: [
				{
					key: `theme look ${ site.path } ${ after.front }`,
					summary: `The front page (page ${ front }) is built on ${ theme }, a theme WordPress updates, and the site has no Global Styles, templates or template parts saved of its own, so it looks as ${ theme } ships for every site that uses it. WordPress keeps a site's own look in its Global Styles${ styles } (WP_Theme_JSON_Resolver::get_user_data() in wp-includes/class-wp-theme-json-resolver.php), in templates and parts saved for the theme (get_block_templates() in wp-includes/block-template-utils.php), or in a theme of the site's own.`,
				},
			],
		};
	},
};
