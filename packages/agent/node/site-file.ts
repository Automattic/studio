/**
 * A file of a local WordPress site, as the notes and refusals on a write to
 * it see it: the site it is in, its path there, and its theme if it is in one.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { opensWithBlock } from '@studio/agent/node/block-validation-gate';
import { themesDir } from '@studio/agent/node/themes';

export interface SiteFile {
	siteRoot: string;
	relativePath: string;
	theme?: { slug: string; dir: string; file: string };
}

/** Locates the WordPress site a path belongs to, and its theme if it is in one. */
export function resolveSiteFile( filePath: string ): SiteFile | undefined {
	let dir = path.dirname( filePath );
	while ( dir !== path.dirname( dir ) ) {
		if (
			existsSync( path.join( dir, 'wp-includes' ) ) &&
			existsSync( path.join( dir, 'wp-content' ) )
		) {
			const relativePath = path.relative( dir, filePath ).split( path.sep ).join( '/' );
			const themeMatch = relativePath.match( /^wp-content\/themes\/([^/]+)\/(.+)$/ );
			return {
				siteRoot: dir,
				relativePath,
				theme: themeMatch
					? {
							slug: themeMatch[ 1 ],
							dir: themesDir( dir, themeMatch[ 1 ] ),
							file: themeMatch[ 2 ],
					  }
					: undefined,
			};
		}
		dir = path.dirname( dir );
	}
	return undefined;
}

// Block markup files: a theme's templates, parts and patterns, and any file
// that opens with a block, as a page draft does wherever it is written.
export function isBlockMarkup( siteFile: SiteFile ): boolean {
	return (
		/^(templates|parts|patterns)\/[^/]+\.(html|php)$/.test( siteFile.theme?.file ?? '' ) ||
		opensWithBlock( readSiteFile( siteFile ) )
	);
}

export const readSiteFile = ( { siteRoot, relativePath }: SiteFile ) =>
	readFileSync( path.join( siteRoot, relativePath ), 'utf8' );
