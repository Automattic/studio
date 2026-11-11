import {
	applyDesignToThemeJson,
	applyThemeToDesign,
	designDrift,
	designSheet,
	fontFamilyName,
	googleFontsUrl,
	parseDesignMd,
	typographyStyles,
	type DesignFix,
} from '@studio/design-md';
import { z } from 'zod';
import { downloadThemeFonts } from '../lib/theme-fonts';

export interface SiteDesign {
	design: string | null;
	themeJson: Record< string, unknown >;
}

export const designFixesSchema = z.array(
	z.object( {
		kind: z.enum( [ 'color', 'font-family', 'font-size', 'spacing', 'style-font' ] ),
		slug: z.string(),
		to: z.enum( [ 'theme', 'design' ] ),
	} )
);

// A site's files, by their path from the site root: on disk for a native site,
// in Playground for Studio on the web.
export interface SiteFiles {
	// Null when the file is missing.
	read( path: string ): Promise< string | null >;
	// Creates missing folders.
	write( path: string, data: string | Uint8Array ): Promise< void >;
}

interface SiteDesignFiles {
	designPath: string;
	themeDir: string;
	themeJsonPath: string;
}

// The theme is only resolved (usually a WP-CLI call) once DESIGN.md is known to exist.
async function locateSiteDesign(
	site: SiteFiles,
	resolveThemeSlug: () => Promise< string | undefined >
): Promise< SiteDesignFiles | null > {
	const designPath = 'DESIGN.md';
	if ( ( await site.read( designPath ) ) === null ) {
		return null;
	}
	const slug = await resolveThemeSlug();
	if ( ! slug || ! /^[\w.-]+$/.test( slug ) || slug.startsWith( '.' ) ) {
		return null;
	}
	const themeDir = `wp-content/themes/${ slug }`;
	return { designPath, themeDir, themeJsonPath: `${ themeDir }/theme.json` };
}

async function readSiteDesignFiles(
	site: SiteFiles,
	files: SiteDesignFiles
): Promise< SiteDesign | null > {
	const [ design, themeJson ] = await Promise.all( [
		site.read( files.designPath ),
		site.read( files.themeJsonPath ),
	] );
	if ( design === null || themeJson === null ) {
		return null;
	}
	try {
		designSheet( parseDesignMd( design ) );
		return { design, themeJson: JSON.parse( themeJson ) };
	} catch {
		return null;
	}
}

/**
 * Reads the site's DESIGN.md board, falling back to WordPress's resolved
 * global styles when the board is unavailable.
 */
export async function readSiteDesign(
	site: SiteFiles,
	resolveThemeSlug: () => Promise< string | undefined >,
	resolveGlobalStyles: () => Promise< Record< string, unknown > | null >
): Promise< SiteDesign | null > {
	const files = await locateSiteDesign( site, resolveThemeSlug );
	const design = files && ( await readSiteDesignFiles( site, files ) );
	if ( design ) {
		return design;
	}
	const themeJson = await resolveGlobalStyles();
	return themeJson ? { design: null, themeJson } : null;
}

/**
 * Settles drifts between DESIGN.md and the active theme's theme.json, downloading
 * the font files of families written to theme.json. Stale fixes are ignored.
 */
export async function fixSiteDesign(
	site: SiteFiles,
	resolveThemeSlug: () => Promise< string | undefined >,
	fixes: DesignFix[]
): Promise< SiteDesign | null > {
	const files = await locateSiteDesign( site, resolveThemeSlug );
	const current = files && ( await readSiteDesignFiles( site, files ) );
	if ( ! files || ! current?.design ) {
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
		const themeFamilies = (
			( current.themeJson.settings as { typography?: { fontFamilies?: { name?: string }[] } } )
				?.typography?.fontFamilies ?? []
		).map( ( family ) => family.name );
		const families = toTheme
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
		const fontFaces = fontsUrl
			? await downloadThemeFonts( fontsUrl, ( themePath, data ) =>
					site.write( `${ files.themeDir }/${ themePath }`, data )
			  )
			: {};
		const themeJson = applyDesignToThemeJson( tokens, current.themeJson, toTheme, fontFaces );
		await site.write( files.themeJsonPath, JSON.stringify( themeJson, null, '\t' ) + '\n' );
	}

	const toDesign = fixed( 'design' );
	if ( toDesign.length ) {
		await site.write( files.designPath, applyThemeToDesign( current.design, toDesign ) );
	}

	return readSiteDesignFiles( site, files );
}
