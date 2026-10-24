import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
	applyDesignToThemeJson,
	applyThemeToDesign,
	designDrift,
	fontFamilyName,
	googleFontsUrl,
	parseDesignMd,
	typographyStyles,
	type DesignDrift,
	type DesignFix,
	type DesignTokens,
} from '@studio/design-md';
import { z } from 'zod';
import { downloadThemeFonts } from '../lib/theme-fonts';

export interface SiteDesign {
	design: string;
	themeJson: Record< string, unknown >;
}

export const designFixesSchema = z.array(
	z.object( {
		kind: z.enum( [ 'color', 'font-family', 'font-size', 'spacing', 'style-font' ] ),
		slug: z.string(),
		to: z.enum( [ 'theme', 'design' ] ),
	} )
);

interface SiteDesignFiles {
	designPath: string;
	themeDir: string;
	themeJsonPath: string;
}

async function readOptionalFile( filePath: string ): Promise< string | null > {
	try {
		return await readFile( filePath, 'utf8' );
	} catch {
		return null;
	}
}

// The theme is only resolved (usually a WP-CLI call) once DESIGN.md is known to exist.
async function locateSiteDesign(
	sitePath: string,
	resolveThemeSlug: () => Promise< string | undefined >
): Promise< SiteDesignFiles | null > {
	const designPath = path.join( sitePath, 'DESIGN.md' );
	if ( ( await readOptionalFile( designPath ) ) === null ) {
		return null;
	}
	const slug = await resolveThemeSlug();
	if ( ! slug || ! /^[\w.-]+$/.test( slug ) || slug.startsWith( '.' ) ) {
		return null;
	}
	const themeDir = path.join( sitePath, 'wp-content', 'themes', slug );
	return { designPath, themeDir, themeJsonPath: path.join( themeDir, 'theme.json' ) };
}

async function readSiteDesignFiles( files: SiteDesignFiles ): Promise< SiteDesign | null > {
	const [ design, themeJson ] = await Promise.all( [
		readOptionalFile( files.designPath ),
		readOptionalFile( files.themeJsonPath ),
	] );
	if ( design === null || themeJson === null ) {
		return null;
	}
	try {
		return { design, themeJson: JSON.parse( themeJson ) };
	} catch {
		return null;
	}
}

/**
 * Reads a site's design system: DESIGN.md at its root and the active theme's
 * theme.json. Resolves null when either is missing.
 */
export async function readSiteDesign(
	sitePath: string,
	resolveThemeSlug: () => Promise< string | undefined >
): Promise< SiteDesign | null > {
	const files = await locateSiteDesign( sitePath, resolveThemeSlug );
	return files && readSiteDesignFiles( files );
}

/**
 * Settles drifts between DESIGN.md and the active theme's theme.json, downloading
 * the font files of families written to theme.json. Stale fixes are ignored.
 */
export async function fixSiteDesign(
	sitePath: string,
	resolveThemeSlug: () => Promise< string | undefined >,
	fixes: DesignFix[]
): Promise< SiteDesign | null > {
	const files = await locateSiteDesign( sitePath, resolveThemeSlug );
	const current = files && ( await readSiteDesignFiles( files ) );
	if ( ! files || ! current ) {
		return null;
	}
	const tokens = parseDesignMd( current.design );
	const drift = designDrift( tokens, current.themeJson );
	const fixed = ( to: DesignFix[ 'to' ] ) =>
		drift.filter( ( entry ) =>
			fixes.some( ( fix ) => fix.kind === entry.kind && fix.slug === entry.slug && fix.to === to )
		);

	const toTheme = fixed( 'theme' );
	if ( toTheme.length ) {
		const fontFaces = await downloadDriftFonts( files, tokens, current.themeJson, toTheme );
		await writeDriftToTheme( files, tokens, current.themeJson, toTheme, fontFaces );
	}

	const toDesign = fixed( 'design' );
	if ( toDesign.length ) {
		await writeFile( files.designPath, applyThemeToDesign( current.design, toDesign ) );
	}

	return readSiteDesignFiles( files );
}

// The font files of the families each drift writes to theme.json, downloaded
// into the theme and keyed by family.
async function downloadDriftFonts(
	files: SiteDesignFiles,
	tokens: DesignTokens,
	themeJson: Record< string, unknown >,
	drift: DesignDrift[]
): Promise< Record< string, object[] > > {
	const themeFamilies = (
		( themeJson.settings as { typography?: { fontFamilies?: { name?: string }[] } } )?.typography
			?.fontFamilies ?? []
	).map( ( family ) => family.name );
	const families = drift
		.filter(
			( entry ) =>
				entry.kind === 'font-family' ||
				( entry.kind === 'style-font' && ! themeFamilies.includes( entry.design ) )
		)
		.map( ( entry ) => entry.design );
	const fontsUrl = googleFontsUrl(
		typographyStyles( tokens )
			.map( ( [ , style ] ) => style )
			.filter( ( style ) => families.includes( fontFamilyName( style.fontFamily ) ) )
	);
	return fontsUrl ? downloadThemeFonts( fontsUrl, files.themeDir ) : {};
}

async function writeDriftToTheme(
	files: SiteDesignFiles,
	tokens: DesignTokens,
	themeJson: Record< string, unknown >,
	drift: DesignDrift[],
	fontFaces: Record< string, object[] >
): Promise< void > {
	const written = applyDesignToThemeJson( tokens, themeJson, drift, fontFaces );
	await writeFile( files.themeJsonPath, JSON.stringify( written, null, '\t' ) + '\n' );
}

export interface SettledThemeDesign {
	drift: DesignDrift[];
	fontsError?: string;
}

/**
 * Makes a theme built on the site's DESIGN.md carry its tokens: every color,
 * font family (with its font files), font size and spacing step under DESIGN.md's
 * name, and its body, heading and button fonts. Resolves the drifts it settled,
 * none when the site has no DESIGN.md or the theme no theme.json.
 */
export async function settleThemeDesign(
	sitePath: string,
	themeSlug: string
): Promise< SettledThemeDesign > {
	const files = await locateSiteDesign( sitePath, async () => themeSlug );
	const current = files && ( await readSiteDesignFiles( files ) );
	if ( ! files || ! current ) {
		return { drift: [] };
	}
	const tokens = parseDesignMd( current.design );
	const drift = designDrift( tokens, current.themeJson, true );
	if ( ! drift.length ) {
		return { drift };
	}
	let fontsError: string | undefined;
	const fontFaces = await downloadDriftFonts( files, tokens, current.themeJson, drift ).catch(
		( error: unknown ) => {
			fontsError = error instanceof Error ? error.message : String( error );
			return {};
		}
	);
	await writeDriftToTheme( files, tokens, current.themeJson, drift, fontFaces );
	return { drift, fontsError };
}
