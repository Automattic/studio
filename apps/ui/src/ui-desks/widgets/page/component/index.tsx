import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { CONTENT_CARD_STATUSES, getPostStatusInfo } from '@/ui-desks/widget-actions/post-status';
import {
	getMediaDropPreviewPayload,
	MediaDropPreview,
} from '@/ui-desks/widgets/media/drop-preview';
import { getPageToneDitherFilterId } from '@/ui-desks/widgets/page/tone';
import styles from './style.module.css';
import type { PageWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type PageWidgetComponentProps = DeskWidgetComponentProps< PageWidgetProps >;
type EmbeddedFeaturedMedia = {
	source_url?: string;
	media_details?: {
		sizes?: Record< string, { source_url?: string } >;
	};
};
type PageCardRecord = CoreDataPost & {
	status?: string;
	slug?: string;
	_embedded?: {
		'wp:featuredmedia'?: EmbeddedFeaturedMedia[];
	};
};

export function PageWidgetComponent( { id, widgetProps, dropFeedback }: PageWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.pageId ],
			per_page: 1,
			context: 'edit',
			status: CONTENT_CARD_STATUSES,
			_embed: true,
			_fields: 'id,title,excerpt,slug,status,featured_media,_links,_embedded',
		} ),
		[ widgetProps.pageId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< PageCardRecord >( 'postType', 'page', query, {
		enabled: widgetProps.pageId > 0,
	} );
	const record = records?.[ 0 ] ?? null;
	const hasError = resolutionStatus === 'ERROR';
	const isLoading = isResolving && ! record;
	const morphMedia = getMediaDropPreviewPayload( dropFeedback );

	if ( isLoading ) {
		return (
			<article
				className={ styles.page }
				data-tone={ widgetProps.tone }
				data-is-loading="true"
				data-studio-desk-widget="page"
				data-studio-desk-widget-id={ id }
				aria-busy="true"
			>
				<LoadingPlaceholder text={ __( 'Loading page' ) } />
			</article>
		);
	}

	const title = getPageTitle( record, isResolving, hasError );
	const excerpt = record?.excerpt?.rendered ?? '';
	const slug = record?.slug ?? '';
	const statusInfo = getPostStatusInfo( record?.status );
	const featuredImage = getPageFeaturedImageUrl( record );
	const ditherFilterId = getPageToneDitherFilterId( widgetProps.tone );
	const headerFilterStyle =
		ditherFilterId && ( morphMedia?.mediaKind ?? 'image' ) === 'image'
			? { filter: `url(#${ ditherFilterId })` }
			: undefined;

	return (
		<article
			className={ styles.page }
			data-tone={ widgetProps.tone }
			data-is-loading="false"
			data-studio-desk-widget="page"
			data-studio-desk-widget-id={ id }
		>
			{ morphMedia ? (
				<MediaDropPreview
					media={ morphMedia }
					className={ `${ styles.pageHeader } ${ styles.pageHeaderMorph }` }
					style={ headerFilterStyle }
				/>
			) : featuredImage ? (
				<img
					key="featured"
					className={ styles.pageHeader }
					src={ featuredImage }
					alt=""
					draggable={ false }
					style={ headerFilterStyle }
				/>
			) : null }
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: title } } />
			{ excerpt && (
				<div className={ styles.body } dangerouslySetInnerHTML={ { __html: excerpt } } />
			) }
			{ record?.status && (
				<div className={ styles.metadata }>
					<span className={ styles.status } title={ statusInfo.label }>
						<span
							className={ styles.statusDot }
							style={ { background: statusInfo.color } }
							aria-hidden="true"
						/>
						<span className={ styles.statusLabel }>{ statusInfo.label }</span>
					</span>
				</div>
			) }
			{ slug && <div className={ styles.slug }>/{ slug }</div> }
		</article>
	);
}

export function PageWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< PageWidgetProps > ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.pageId ],
			per_page: 1,
			context: 'edit',
			status: CONTENT_CARD_STATUSES,
			_fields: 'id,title,slug,status',
		} ),
		[ widgetProps.pageId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< PageCardRecord >( 'postType', 'page', query, {
		enabled: widgetProps.pageId > 0,
	} );
	const record = records?.[ 0 ] ?? null;
	const title = getPageTitle( record, isResolving, resolutionStatus === 'ERROR' );
	const slug = record?.slug ? `/${ record.slug }` : '';

	return (
		<article
			className={ styles.contextThumbnail }
			data-tone={ widgetProps.tone }
			data-studio-desk-widget="page"
			data-studio-desk-widget-id={ id }
		>
			<div
				className={ styles.contextThumbnailTitle }
				dangerouslySetInnerHTML={ { __html: title } }
			/>
			{ slug && <div className={ styles.contextThumbnailSlug }>{ slug }</div> }
		</article>
	);
}

function getPageTitle(
	pageRecord: PageCardRecord | null,
	isResolving: boolean,
	hasError: boolean
) {
	if ( pageRecord ) {
		return pageRecord.title?.rendered || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load page' );
	}

	return isResolving ? __( 'Loading page…' ) : __( 'Page unavailable' );
}

function getPageFeaturedImageUrl( pageRecord: PageCardRecord | null ): string | undefined {
	const featured = pageRecord?._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	if ( ! featured ) {
		return undefined;
	}

	const sizes = featured.media_details?.sizes ?? {};
	return (
		sizes.medium_large?.source_url ??
		sizes.large?.source_url ??
		sizes.medium?.source_url ??
		featured.source_url
	);
}
