import { readFile } from 'node:fs/promises';
import path from 'node:path';

export interface SiteDesign {
	// DESIGN.md at the site root, as written.
	design: string;
	// The active theme's theme.json, parsed.
	themeJson: Record< string, unknown >;
}

async function readOptionalFile( filePath: string ): Promise< string | null > {
	try {
		return await readFile( filePath, 'utf8' );
	} catch {
		return null;
	}
}

/**
 * Reads a site's design system: DESIGN.md at its root and the active theme's
 * theme.json. Resolves null when either is missing. The theme is only resolved
 * (usually a WP-CLI call) once DESIGN.md is known to exist.
 */
export async function readSiteDesign(
	sitePath: string,
	resolveThemeSlug: () => Promise< string | undefined >
): Promise< SiteDesign | null > {
	const design = await readOptionalFile( path.join( sitePath, 'DESIGN.md' ) );
	if ( design === null ) {
		return null;
	}
	const slug = await resolveThemeSlug();
	if ( ! slug || ! /^[\w.-]+$/.test( slug ) || slug.startsWith( '.' ) ) {
		return null;
	}
	const themeJson = await readOptionalFile(
		path.join( sitePath, 'wp-content', 'themes', slug, 'theme.json' )
	);
	if ( themeJson === null ) {
		return null;
	}
	try {
		return { design, themeJson: JSON.parse( themeJson ) };
	} catch {
		return null;
	}
}
