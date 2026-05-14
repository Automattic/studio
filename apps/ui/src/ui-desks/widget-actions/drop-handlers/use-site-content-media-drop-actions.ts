import { store as coreDataStore } from '@wordpress/core-data';
import { useDispatch, useRegistry } from '@wordpress/data';
import { useCallback, useMemo } from 'react';

export type SiteContentKind = 'post' | 'page';

export interface SiteContentMediaBlock {
	id: number;
	url: string;
	alt?: string;
	kind: 'image' | 'video';
}

interface EditableContentRecord {
	id: number;
	content?:
		| string
		| {
				raw?: string;
				rendered?: string;
		  };
}

interface CoreDataContentResolvers {
	getEntityRecord: (
		kind: 'postType',
		name: SiteContentKind,
		key: number,
		query: typeof CONTENT_RECORD_QUERY
	) => Promise< EditableContentRecord | undefined >;
}

const CONTENT_RECORD_QUERY = {
	context: 'edit',
	_fields: 'id,content',
} as const;

export function useSiteContentMediaDropActions() {
	const registry = useRegistry();
	const { saveEntityRecord } = useDispatch( coreDataStore );

	const setFeaturedMedia = useCallback(
		( kind: SiteContentKind, contentId: number, mediaId: number ) =>
			saveEntityRecord(
				'postType',
				kind,
				{
					id: contentId,
					featured_media: mediaId,
				},
				{ throwOnError: true }
			),
		[ saveEntityRecord ]
	);

	const attachMediaToContent = useCallback(
		( mediaId: number, contentId: number ) =>
			saveEntityRecord(
				'postType',
				'attachment',
				{
					id: mediaId,
					post: contentId,
				},
				{ throwOnError: true }
			),
		[ saveEntityRecord ]
	);

	const insertMediaBlock = useCallback(
		async ( kind: SiteContentKind, contentId: number, media: SiteContentMediaBlock ) => {
			const current = await getCoreDataContentResolvers( registry ).getEntityRecord(
				'postType',
				kind,
				contentId,
				CONTENT_RECORD_QUERY
			);

			if ( ! current ) {
				throw new Error( `Unable to load ${ kind } ${ contentId } before inserting media.` );
			}

			return await saveEntityRecord(
				'postType',
				kind,
				{
					id: contentId,
					content: `${ getContentSource( current ) }${ createMediaBlockMarkup( media ) }`,
				},
				{ throwOnError: true }
			);
		},
		[ registry, saveEntityRecord ]
	);

	return useMemo(
		() => ( {
			attachMediaToContent,
			insertMediaBlock,
			setFeaturedMedia,
		} ),
		[ attachMediaToContent, insertMediaBlock, setFeaturedMedia ]
	);
}

function getCoreDataContentResolvers( registry: ReturnType< typeof useRegistry > ) {
	return registry.resolveSelect( coreDataStore ) as unknown as CoreDataContentResolvers;
}

function getContentSource( record: EditableContentRecord ) {
	if ( typeof record.content === 'string' ) {
		return record.content;
	}

	return record.content?.raw ?? record.content?.rendered ?? '';
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
