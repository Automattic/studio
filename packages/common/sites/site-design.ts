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
	type DesignFix,
} from '@studio/design-md';
import { z } from 'zod';
import { downloadThemeFonts } from '../lib/theme-fonts';

export interface SiteDesign {
	// DESIGN.md at the site root, as written.
	design: string;
	// The active theme's theme.json, parsed.
	themeJson: Record< string, unknown >;
}

export const designFixesSchema = z.array(
	z.object( {
		kind: z.enum( [ 'color', 'font-family', 'font-files', 'font-size', 'spacing' ] ),
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
 * Settles drifts between DESIGN.md and the active theme's theme.json, each in the
 * direction its fix names, downloading the font files of families written to
 * theme.json. Fixes for drifts that no longer exist are ignored. Resolves the
 * design system as it stands afterwards.
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
		const families = toTheme
			.filter( ( entry ) => entry.kind === 'font-family' || entry.kind === 'font-files' )
			.map( ( entry ) => entry.design );
		const fontsUrl = googleFontsUrl(
			typographyStyles( tokens )
				.map( ( [ , style ] ) => style )
				.filter( ( style ) => families.includes( fontFamilyName( style.fontFamily ) ) )
		);
		const fontFaces = fontsUrl ? await downloadThemeFonts( fontsUrl, files.themeDir ) : {};
		const themeJson = applyDesignToThemeJson( tokens, current.themeJson, toTheme, fontFaces );
		await writeFile( files.themeJsonPath, JSON.stringify( themeJson, null, '\t' ) + '\n' );
	}

	const toDesign = fixed( 'design' );
	if ( toDesign.length ) {
		await writeFile( files.designPath, applyThemeToDesign( current.design, toDesign ) );
	}

	return readSiteDesignFiles( files );
}
