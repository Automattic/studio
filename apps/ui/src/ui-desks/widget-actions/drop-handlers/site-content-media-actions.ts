import { store as coreDataStore } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import type {
	WidgetCustomDropAction,
	WidgetCustomDropActionContext,
	WidgetResolverRegistry,
} from '@/ui-desks/widgets/types';

type SiteContentKind = 'post' | 'page';

interface SiteContentMediaBlock {
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

export function getSiteContentMediaDropActions( {
	kind,
	contentId,
	attachLabel,
	media,
	context,
}: {
	kind: SiteContentKind;
	contentId: number;
	attachLabel: string;
	media: SiteContentMediaBlock;
	context: WidgetCustomDropActionContext;
} ): WidgetCustomDropAction[] {
	return [
		{
			label: __( 'Set as featured media' ),
			onClick: () =>
				context.runAction( () => setFeaturedMedia( kind, contentId, media.id, context ) ),
		},
		{
			label: attachLabel,
			onClick: () =>
				context.runAction( () => attachMediaToContent( media.id, contentId, context ) ),
		},
		{
			label: __( 'Insert media block' ),
			onClick: () => context.runAction( () => insertMediaBlock( kind, contentId, media, context ) ),
		},
	];
}

function setFeaturedMedia(
	kind: SiteContentKind,
	contentId: number,
	mediaId: number,
	context: WidgetCustomDropActionContext
) {
	return context.saveEntityRecord(
		'postType',
		kind,
		{
			id: contentId,
			featured_media: mediaId,
		},
		{ throwOnError: true }
	);
}

function attachMediaToContent(
	mediaId: number,
	contentId: number,
	context: WidgetCustomDropActionContext
) {
	return context.saveEntityRecord(
		'postType',
		'attachment',
		{
			id: mediaId,
			post: contentId,
		},
		{ throwOnError: true }
	);
}

async function insertMediaBlock(
	kind: SiteContentKind,
	contentId: number,
	media: SiteContentMediaBlock,
	context: WidgetCustomDropActionContext
) {
	const current = await getCoreDataContentResolvers( context.registry ).getEntityRecord(
		'postType',
		kind,
		contentId,
		CONTENT_RECORD_QUERY
	);

	if ( ! current ) {
		throw new Error( `Unable to load ${ kind } ${ contentId } before inserting media.` );
	}

	return await context.saveEntityRecord(
		'postType',
		kind,
		{
			id: contentId,
			content: `${ getContentSource( current ) }${ createMediaBlockMarkup( media ) }`,
		},
		{ throwOnError: true }
	);
}

function getCoreDataContentResolvers( registry: WidgetResolverRegistry ) {
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
