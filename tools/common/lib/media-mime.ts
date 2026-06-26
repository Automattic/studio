import path from 'node:path';

/** Supported local-media MIME types, keyed by lowercase extension. */
export const MEDIA_MIME_TYPES: Record< string, string > = {
	avif: 'image/avif',
	avi: 'video/x-msvideo',
	bmp: 'image/bmp',
	gif: 'image/gif',
	heic: 'image/heic',
	heif: 'image/heif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	m4v: 'video/x-m4v',
	mkv: 'video/x-matroska',
	mov: 'video/quicktime',
	mp4: 'video/mp4',
	mpeg: 'video/mpeg',
	mpg: 'video/mpeg',
	ogv: 'video/ogg',
	png: 'image/png',
	svg: 'image/svg+xml',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	webm: 'video/webm',
	webp: 'image/webp',
};

/**
 * Resolve the MIME type for a local media file by its extension, or `''` when
 * the type isn't supported.
 */
export function getLocalMediaMimeType( filePath: string ): string {
	return MEDIA_MIME_TYPES[ path.extname( filePath ).toLowerCase().slice( 1 ) ] ?? '';
}
