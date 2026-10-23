import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeFile } from 'atomically';
import { getConfigDirectory } from './well-known-paths';

// The last page of each site that finished loading in a preview, shown while
// the site is stopped. Shared by the Desktop app and `studio ui`.

function getSitePreviewPath( siteId: string ): string {
	// Hashed, so a site id never becomes part of a path.
	const name = createHash( 'sha256' ).update( siteId ).digest( 'hex' );
	return path.join( getConfigDirectory(), 'previews', `${ name }.png` );
}

// Sign-in and dashboard screens say nothing about what the site looks like.
export function isSitePreviewPath( pagePath: string ): boolean {
	return ! /^\/(wp-admin|wp-login\.php|studio-auto-login)\b/.test( pagePath );
}

export async function writeSitePreview( siteId: string, png: Buffer ): Promise< void > {
	const file = getSitePreviewPath( siteId );
	await mkdir( path.dirname( file ), { recursive: true } );
	await writeFile( file, png );
}

/** A `data:` URL of the site's preview, falling back to an older capture. */
export async function readSitePreview(
	siteId: string,
	fallbackPath?: string
): Promise< string | null > {
	for ( const file of [ getSitePreviewPath( siteId ), fallbackPath ] ) {
		if ( ! file ) {
			continue;
		}
		try {
			return `data:image/png;base64,${ ( await readFile( file ) ).toString( 'base64' ) }`;
		} catch {
			// Not captured yet; try the next one.
		}
	}
	return null;
}
