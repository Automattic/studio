import { realpath, stat } from 'node:fs/promises';
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

// `requested` with symlinks resolved, when it lies inside `root` both as
// written and once resolved.
async function resolveWithinRoot( root: string, requested: string ): Promise< string | null > {
	const candidate = path.resolve( root, requested );
	if ( ! candidate.startsWith( path.resolve( root ) + path.sep ) ) {
		return null;
	}
	try {
		const resolved = await realpath( candidate );
		return resolved.startsWith( ( await realpath( root ) ) + path.sep ) ? resolved : null;
	} catch {
		return null;
	}
}

export interface LocalMediaFile {
	path: string;
	mimeType: string;
	size: number;
	root: string;
}

/**
 * Resolves a media file the agent wrote (screenshots in the sessions folder,
 * generated images in a site) to a raster image inside one of `roots`, or null.
 * A path under a pre-migration sessions folder resolves to its new location.
 */
export async function resolveLocalMediaFile(
	requested: string,
	roots: string[]
): Promise< LocalMediaFile | null > {
	const mimeType = getLocalMediaMimeType( requested );
	if ( ! LOCAL_MEDIA_MIME_TYPES.has( mimeType ) ) {
		return null;
	}
	for ( const candidate of new Set( [ requested, resolveMigratedAiSessionsPath( requested ) ] ) ) {
		for ( const root of roots ) {
			const resolved = await resolveWithinRoot( root, candidate );
			const stats = resolved ? await stat( resolved ).catch( () => null ) : null;
			if ( resolved && stats?.isFile() ) {
				return { path: resolved, mimeType, size: stats.size, root };
			}
		}
	}
	return null;
}
