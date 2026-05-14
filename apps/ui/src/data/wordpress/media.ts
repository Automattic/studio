import apiFetch from '@wordpress/api-fetch';
import type { Attachment } from '@wordpress/core-data';

export type SiteContentKind = 'post' | 'page';

export interface SiteContentMediaBlock {
	id: number;
	url: string;
	alt?: string;
	kind: 'image' | 'video';
}

type EditableContentRecord = {
	id: number;
	content?: {
		raw?: string;
		rendered?: string;
	};
};

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

export async function setSiteContentFeaturedMedia(
	kind: SiteContentKind,
	contentId: number,
	mediaId: number
): Promise< unknown > {
	return await apiFetch( {
		path: `/wp/v2/${ getContentEndpoint( kind ) }/${ contentId }?_embed=1`,
		method: 'POST',
		data: {
			featured_media: mediaId,
		},
	} );
}

export async function attachSiteMediaToContent(
	mediaId: number,
	contentId: number
): Promise< unknown > {
	return await apiFetch( {
		path: `/wp/v2/media/${ mediaId }`,
		method: 'POST',
		data: {
			post: contentId,
		},
	} );
}

export async function appendSiteContentMediaBlock(
	kind: SiteContentKind,
	contentId: number,
	media: SiteContentMediaBlock
): Promise< unknown > {
	const current = await apiFetch< EditableContentRecord >( {
		path: `/wp/v2/${ getContentEndpoint( kind ) }/${ contentId }?context=edit&_fields=id,content`,
	} );
	const existingContent = current.content?.raw ?? current.content?.rendered ?? '';

	return await apiFetch( {
		path: `/wp/v2/${ getContentEndpoint( kind ) }/${ contentId }?_embed=1`,
		method: 'POST',
		data: {
			content: `${ existingContent }${ createMediaBlockMarkup( media ) }`,
		},
	} );
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

function getContentEndpoint( kind: SiteContentKind ) {
	return kind === 'page' ? 'pages' : 'posts';
}

function createMediaBlockMarkup( media: SiteContentMediaBlock ) {
	const url = escapeHtmlAttribute( media.url );
	const alt = escapeHtmlAttribute( media.alt ?? '' );

	if ( media.kind === 'video' ) {
		return `\n<!-- wp:video {"id":${ media.id }} -->\n<figure class="wp-block-video"><video controls src="${ url }"></video></figure>\n<!-- /wp:video -->\n`;
	}

	return `\n<!-- wp:image {"id":${ media.id },"sizeSlug":"large"} -->\n<figure class="wp-block-image size-large"><img src="${ url }" alt="${ alt }" class="wp-image-${ media.id }"/></figure>\n<!-- /wp:image -->\n`;
}

function escapeHtmlAttribute( value: string ) {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /"/g, '&quot;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' );
}
