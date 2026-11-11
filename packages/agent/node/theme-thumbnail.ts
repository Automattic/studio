/**
 * The thumbnail Appearance → Themes shows for a theme Studio's agent makes.
 */
import { readdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { parentThemeDir } from '@studio/agent/node/themes';
import { renderDesignBoard } from '@studio/agent/shared/design-board';
import { captureScreenshotBuffer } from '@studio/agent/shared/tools/screenshot-helpers';
import type { SiteFile } from '@studio/agent/node/site-file';
import type { StudioAgentHost } from '@studio/agent/shared/host';

const THUMBNAIL = { width: 1200, height: 900 } as const;

// A theme's theme.json as WordPress resolves it: a child's merged over its
// parent's (WP_Theme_JSON_Resolver::get_theme_data()), a list it declares,
// such as a preset list, replacing the parent's (WP_Theme_JSON::merge()).
async function resolvedThemeJson( themeDir: string ): Promise< object | undefined > {
	const read = async ( dir: string | undefined ) =>
		dir
			? readFile( path.join( dir, 'theme.json' ), 'utf8' )
					.then( ( text ): unknown => JSON.parse( text ) )
					.catch( () => undefined )
			: undefined;
	const [ own, parent ] = await Promise.all( [
		read( themeDir ),
		read( await parentThemeDir( themeDir ) ),
	] );
	const merged = mergeThemeJson( parent, own );
	return isObject( merged ) ? merged : undefined;
}

const isObject = ( value: unknown ): value is Record< string, unknown > =>
	Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );

function mergeThemeJson( base: unknown, incoming: unknown ): unknown {
	if ( ! isObject( base ) || ! isObject( incoming ) ) {
		return incoming ?? base;
	}
	const merged: Record< string, unknown > = { ...base };
	for ( const [ key, value ] of Object.entries( incoming ) ) {
		merged[ key ] = mergeThemeJson( base[ key ], value );
	}
	return merged;
}

/**
 * Gives a theme without a thumbnail one, on a write to any of its files once
 * it has a theme.json to draw: the design board of the theme.json WordPress
 * resolves for it, the 1200×900 screenshot.png Appearance → Themes shows
 * (WP_Theme::get_screenshot() reads the theme's own directory, a child's too).
 * A capture that fails is made again on the theme's next write.
 */
export async function writeThemeThumbnail(
	host: StudioAgentHost,
	siteFile: SiteFile
): Promise< string[] > {
	const { theme } = siteFile;
	if (
		! theme ||
		thumbnailsBeingMade.has( theme.dir ) ||
		readdirSync( theme.dir ).some( ( file ) => /^screenshot\.(png|jpe?g|gif|webp)$/.test( file ) )
	) {
		return [];
	}
	// Writes to one theme run at once when the agent makes them in one turn:
	// the first makes its thumbnail.
	thumbnailsBeingMade.add( theme.dir );
	try {
		return await makeThemeThumbnail( host, theme );
	} finally {
		thumbnailsBeingMade.delete( theme.dir );
	}
}

// The themes whose thumbnail a write is making now, by folder.
const thumbnailsBeingMade = new Set< string >();

async function makeThemeThumbnail(
	host: StudioAgentHost,
	theme: NonNullable< SiteFile[ 'theme' ] >
): Promise< string[] > {
	const themeJson = await resolvedThemeJson( theme.dir );
	if ( ! themeJson ) {
		return [];
	}
	const { buffer } = await captureScreenshotBuffer(
		host.pages,
		{ html: renderDesignBoard( JSON.stringify( themeJson ) ) },
		THUMBNAIL,
		{ fullPage: false, format: 'png' }
	);
	await writeFile( path.join( theme.dir, 'screenshot.png' ), buffer );
	return [
		`Studio saved the theme's design board as wp-content/themes/${ theme.slug }/screenshot.png, its thumbnail in Appearance → Themes.`,
	];
}
