import { stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveMigratedAiSessionsPath } from '@studio/common/ai/sessions/root-migration';
import { getLocalMediaMimeType } from '@studio/common/lib/media-mime';

// Raster formats only: an SVG served from the `studio ui` API origin could run
// scripts there, and the UI only renders local media as <img>.
const LOCAL_MEDIA_MIME_TYPES = new Set( [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
	'image/avif',
] );

/**
 * Resolves an image the agent wrote (screenshots in the sessions folder,
 * generated images in a site) when its path lies inside one of `roots`, or null.
 * Symlinks are followed, so a theme or uploads folder linked in from elsewhere
 * still works. A path under a pre-migration sessions folder resolves to its new
 * location.
 */
export async function resolveLocalMediaFile(
	requested: string,
	roots: string[]
): Promise< { path: string; mimeType: string; size: number; root: string } | null > {
	const mimeType = getLocalMediaMimeType( requested );
	if ( ! LOCAL_MEDIA_MIME_TYPES.has( mimeType ) ) {
		return null;
	}
	for ( const candidate of new Set( [ requested, resolveMigratedAiSessionsPath( requested ) ] ) ) {
		for ( const root of roots ) {
			const file = path.resolve( root, candidate );
			const relative = path.relative( root, file );
			if (
				! relative ||
				relative === '..' ||
				relative.startsWith( `..${ path.sep }` ) ||
				path.isAbsolute( relative )
			) {
				continue;
			}
			const stats = await stat( file ).catch( () => null );
			if ( stats?.isFile() ) {
				return { path: file, mimeType, size: stats.size, root };
			}
		}
	}
	return null;
}
