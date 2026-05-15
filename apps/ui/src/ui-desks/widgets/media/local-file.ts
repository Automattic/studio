import type { MediaKind, MediaWidgetProps } from './types';

const IMAGE_MIME_BY_EXTENSION: Record< string, string > = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	heic: 'image/heic',
	heif: 'image/heif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	tif: 'image/tiff',
	tiff: 'image/tiff',
	webp: 'image/webp',
};

const VIDEO_MIME_BY_EXTENSION: Record< string, string > = {
	avi: 'video/x-msvideo',
	m4v: 'video/x-m4v',
	mkv: 'video/x-matroska',
	mov: 'video/quicktime',
	mp4: 'video/mp4',
	mpeg: 'video/mpeg',
	mpg: 'video/mpeg',
	ogv: 'video/ogg',
	webm: 'video/webm',
};

export const MEDIA_FILE_EXTENSIONS = [
	...Object.keys( IMAGE_MIME_BY_EXTENSION ),
	...Object.keys( VIDEO_MIME_BY_EXTENSION ),
];

export function getMediaKindForMimeType( mimeType: string ): MediaKind | null {
	if ( mimeType.startsWith( 'image/' ) ) {
		return 'image';
	}

	if ( mimeType.startsWith( 'video/' ) ) {
		return 'video';
	}

	return null;
}

export function getMediaMimeTypeFromFilename( filename: string ) {
	const extension = getFileExtension( filename );
	if ( ! extension ) {
		return '';
	}

	return IMAGE_MIME_BY_EXTENSION[ extension ] ?? VIDEO_MIME_BY_EXTENSION[ extension ] ?? '';
}

export function getMediaKindForFilename( filename: string ): MediaKind | null {
	const mimeType = getMediaMimeTypeFromFilename( filename );
	return mimeType ? getMediaKindForMimeType( mimeType ) : null;
}

export function createLocalFileUrl( filePath: string ) {
	const normalizedPath = filePath.replace( /\\/g, '/' );

	if ( /^[a-zA-Z]:\//.test( normalizedPath ) ) {
		const [ drive, ...segments ] = normalizedPath.split( '/' );
		return `file:///${ drive }/${ encodePathSegments( segments ) }`;
	}

	if ( normalizedPath.startsWith( '//' ) ) {
		return `file://${ encodePathSegments( normalizedPath.slice( 2 ).split( '/' ) ) }`;
	}

	const absolutePath = normalizedPath.startsWith( '/' ) ? normalizedPath : `/${ normalizedPath }`;
	return `file://${ encodePathSegments( absolutePath.split( '/' ) ) }`;
}

export function getLocalMediaPath( widgetProps: MediaWidgetProps ) {
	if ( widgetProps.source?.type === 'local' && widgetProps.source.path ) {
		return widgetProps.source.path;
	}

	return getLocalPathFromFileUrl( widgetProps.url );
}

export function getLocalPathFromFileUrl( fileUrl: string ) {
	if ( ! fileUrl.startsWith( 'file://' ) ) {
		return null;
	}

	try {
		const url = new URL( fileUrl );
		const pathname = decodeURIComponent( url.pathname );
		if ( /^\/[a-zA-Z]:\//.test( pathname ) ) {
			return pathname.slice( 1 ).replace( /\//g, '\\' );
		}
		if ( url.hostname ) {
			return `\\\\${ url.hostname }${ pathname.replace( /\//g, '\\' ) }`;
		}
		return pathname;
	} catch {
		return null;
	}
}

function encodePathSegments( segments: string[] ) {
	return segments.map( ( segment ) => encodeURIComponent( segment ) ).join( '/' );
}

function getFileExtension( filename: string ) {
	const extension = filename.toLowerCase().split( '.' ).at( -1 );
	return extension && extension !== filename.toLowerCase() ? extension : '';
}
