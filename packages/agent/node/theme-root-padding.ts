/**
 * A theme.json that pads the page at its sides without
 * settings.useRootPaddingAwareAlignments true. WordPress then outputs the
 * root styles.spacing.padding as the body's own padding
 * (WP_Theme_JSON::get_styles_for_block(), whose compute_style_properties()
 * makes the --wp--style--root--padding-* variables only with the setting), so
 * every block, align full ones too, sits inside it. With the setting true the
 * left and right padding go inside each .has-global-padding container, whose
 * align full children take it back as negative margins
 * (get_root_layout_rules() in wp-includes/class-wp-theme-json.php). In the
 * eval29 picky case a theme.json rewrite dropped the setting Studio's
 * scaffold gives it, and the header stood 24px from each side of the window.
 *
 * A child theme's theme.json is merged over its parent's
 * (WP_Theme_JSON_Resolver::get_theme_data()), so each value is the child's
 * where it has one and the parent's otherwise. Global Styles saved in the
 * Site Editor are not read here.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { parentTheme, themesDir } from '@studio/agent/node/themes';
import type { SiteFile } from '@studio/agent/node/site-file';

interface ThemeJson {
	settings?: { useRootPaddingAwareAlignments?: unknown };
	styles?: { spacing?: { padding?: unknown } };
}

const SIDES = [ 'left', 'right' ] as const;

async function readThemeJson( file: string ): Promise< ThemeJson | undefined > {
	try {
		const json = JSON.parse( await readFile( file, 'utf8' ) );
		return json && typeof json === 'object' ? json : undefined;
	} catch {
		return undefined;
	}
}

// The sides of styles.spacing.padding as an object, as get_root_layout_rules()
// reads them; a shorthand string is no padding by side.
function sidesOf( json: ThemeJson | undefined ): Partial< Record< 'left' | 'right', unknown > > {
	const padding = json?.styles?.spacing?.padding;
	return padding && typeof padding === 'object' && ! Array.isArray( padding )
		? ( padding as Record< string, unknown > )
		: {};
}

const isZero = ( value: unknown ) =>
	value === undefined ||
	value === null ||
	value === 0 ||
	( typeof value === 'string' && /^\s*(0*\.?0+([a-z]+|%)?)?\s*$/i.test( value ) );

const shown = ( value: unknown ) => ( typeof value === 'string' ? value : JSON.stringify( value ) );

/** A write source: the note on a theme.json whose side padding keeps full-width blocks from the window's edges. */
export async function themeRootPaddingNotes( siteFile: SiteFile ): Promise< string[] > {
	const { theme, siteRoot, relativePath } = siteFile;
	if ( theme?.file !== 'theme.json' ) {
		return [];
	}
	const own = await readThemeJson( path.join( theme.dir, 'theme.json' ) );
	if ( ! own ) {
		return [];
	}
	const parent = await parentTheme( siteRoot, theme.slug );
	const inherited =
		parent && parent !== theme.slug
			? await readThemeJson( path.join( themesDir( siteRoot, parent ), 'theme.json' ) )
			: undefined;
	const ownSetting = own.settings?.useRootPaddingAwareAlignments;
	const setting =
		ownSetting !== undefined ? ownSetting : inherited?.settings?.useRootPaddingAwareAlignments;
	if ( setting === true ) {
		return [];
	}
	const ownSides = sidesOf( own );
	const parentSides = sidesOf( inherited );
	const sides = SIDES.map( ( side ) => ( {
		side,
		value: side in ownSides ? ownSides[ side ] : parentSides[ side ],
		fromParent: ! ( side in ownSides ) && side in parentSides,
	} ) ).filter( ( { value } ) => ! isZero( value ) );
	if ( ! sides.length ) {
		return [];
	}
	const overParent =
		ownSetting === undefined && inherited?.settings?.useRootPaddingAwareAlignments !== undefined;
	const merged = parent && ( overParent || sides.some( ( { fromParent } ) => fromParent ) );
	return [
		`${ relativePath }${
			merged ? `, merged over its parent ${ parent }'s theme.json,` : ''
		} pads the page by styles.spacing.padding (${ sides
			.map( ( { side, value } ) => `${ side } ${ shown( value ) }` )
			.join(
				', '
			) }) without settings.useRootPaddingAwareAlignments true, so WordPress puts that padding on the body and full-width blocks stop that far from the window's edges; with the setting true it goes inside each .has-global-padding container, whose full-width children reach the edges (get_styles_for_block() and get_root_layout_rules() in wp-includes/class-wp-theme-json.php).`,
	];
}
