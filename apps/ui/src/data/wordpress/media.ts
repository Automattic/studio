import apiFetch from '@wordpress/api-fetch';

export interface UploadedSiteMedia {
	id: number;
	sourceUrl: string;
	altText: string;
	mimeType: string;
	mediaType: string;
}

interface WpMediaResponse {
	id?: unknown;
	source_url?: unknown;
	alt_text?: unknown;
	mime_type?: unknown;
	media_type?: unknown;
}

export async function uploadSiteMedia( file: File ): Promise< UploadedSiteMedia > {
	const response = await apiFetch< unknown, false >( {
		path: '/wp/v2/media',
		method: 'POST',
		headers: {
			'Content-Disposition': getContentDisposition( file.name ),
			'Content-Type': file.type || 'application/octet-stream',
		},
		body: file,
		parse: false,
	} );

	if ( response.status < 200 || response.status >= 300 ) {
		throw new Error( `Media upload failed with status ${ response.status }.` );
	}

	return normalizeMediaResponse( ( await response.json() ) as WpMediaResponse );
}

function getContentDisposition( filename: string ) {
	const fallbackFilename = filename.replace( /[^\x20-\x7e]|["\\\r\n]/g, '_' ) || 'media';
	return `attachment; filename="${ fallbackFilename }"; filename*=UTF-8''${ encodeURIComponent(
		filename
	) }`;
}

function normalizeMediaResponse( response: WpMediaResponse ): UploadedSiteMedia {
	if ( typeof response.id !== 'number' || typeof response.source_url !== 'string' ) {
		throw new Error( 'Media upload response was invalid.' );
	}

	return {
		id: response.id,
		sourceUrl: response.source_url,
		altText: typeof response.alt_text === 'string' ? response.alt_text : '',
		mimeType: typeof response.mime_type === 'string' ? response.mime_type : '',
		mediaType: typeof response.media_type === 'string' ? response.media_type : '',
	};
}
