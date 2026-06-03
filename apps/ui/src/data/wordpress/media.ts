import apiFetch from '@wordpress/api-fetch';
import type { Attachment } from '@wordpress/core-data';

export async function uploadSiteMedia( file: File ): Promise< Attachment > {
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

	const attachment = ( await response.json() ) as unknown;
	if ( ! isUploadedAttachment( attachment ) ) {
		throw new Error( 'Media upload response was invalid.' );
	}

	return attachment;
}

function getContentDisposition( filename: string ) {
	const fallbackFilename = filename.replace( /[^\x20-\x7e]|["\\\r\n]/g, '_' ) || 'media';
	return `attachment; filename="${ fallbackFilename }"; filename*=UTF-8''${ encodeURIComponent(
		filename
	) }`;
}

function isUploadedAttachment( value: unknown ): value is Attachment {
	const attachment = value as Partial< Attachment >;
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		typeof attachment.id === 'number' &&
		typeof attachment.source_url === 'string'
	);
}
