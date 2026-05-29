import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { CONTENT_CARD_STATUSES } from '@/ui-desks/widget-actions/post-status';
import {
	getMediaDropPreviewPayload,
	MediaDropPreview,
} from '@/ui-desks/widgets/media/drop-preview';
import { useCommentCount } from '../use-comment-count';
import styles from './style.module.css';
import type { PostWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

type PostWidgetComponentProps = DeskWidgetComponentProps< PostWidgetProps >;
type EmbeddedFeaturedMedia = {
	source_url?: string;
	media_details?: {
		sizes?: Record< string, { source_url?: string } >;
	};
};
type PostCardRecord = CoreDataPost & {
	_embedded?: {
		'wp:featuredmedia'?: EmbeddedFeaturedMedia[];
	};
};

export function PostWidgetComponent( { id, widgetProps, dropFeedback }: PostWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.postId ],
			per_page: 1,
			context: 'edit',
			status: CONTENT_CARD_STATUSES,
			_embed: true,
			_fields: 'id,title,excerpt,featured_media,_links,_embedded',
		} ),
		[ widgetProps.postId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< PostCardRecord >( 'postType', 'post', query, {
		enabled: widgetProps.postId > 0,
	} );
	const record = records?.[ 0 ] ?? null;
	const hasError = resolutionStatus === 'ERROR';
	const isLoading = isResolving && ! record;
	const commentCount = useCommentCount( record ? widgetProps.postId : null );
	const morphMedia = getMediaDropPreviewPayload( dropFeedback );

	if ( isLoading ) {
		return (
			<article
				className={ styles.post }
				data-is-loading="true"
				data-studio-desk-widget="post"
				data-studio-desk-widget-id={ id }
				aria-busy="true"
			>
				<LoadingPlaceholder text={ __( 'Loading post' ) } />
			</article>
		);
	}

	const title = getPostTitle( record, isResolving, hasError );
	const excerpt = record?.excerpt?.rendered ?? '';
	const featuredImage = getFeaturedImageUrl( record );
	const showFeaturedImage = ! excerpt.trim() && Boolean( featuredImage );

	return (
		<article
			className={ styles.post }
			data-is-loading="false"
			data-studio-desk-widget="post"
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: title } } />
			{ morphMedia ? (
				<MediaDropPreview
					media={ morphMedia }
					className={ `${ styles.featuredImage } ${ styles.featuredImageMorph }` }
				/>
			) : showFeaturedImage && featuredImage ? (
				<img className={ styles.featuredImage } src={ featuredImage } alt="" draggable={ false } />
			) : excerpt ? (
				<div className={ styles.body } dangerouslySetInnerHTML={ { __html: excerpt } } />
			) : null }
			{ commentCount > 0 && (
				<div
					className={ styles.comments }
					aria-label={ sprintf( _n( '%d comment', '%d comments', commentCount ), commentCount ) }
				>
					<Icon icon={ comment } size={ 24 } />
					<span>{ commentCount }</span>
				</div>
			) }
		</article>
	);
}

export function PostWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< PostWidgetProps > ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.postId ],
			per_page: 1,
			context: 'edit',
			status: CONTENT_CARD_STATUSES,
			_fields: 'id,title',
		} ),
		[ widgetProps.postId ]
	);
	const {
		records,
		isResolving,
		status: resolutionStatus,
	} = useEntityRecords< PostCardRecord >( 'postType', 'post', query, {
		enabled: widgetProps.postId > 0,
	} );
	const title = getPostTitle( records?.[ 0 ] ?? null, isResolving, resolutionStatus === 'ERROR' );

	return (
		<article
			className={ styles.contextThumbnail }
			data-studio-desk-widget="post"
			data-studio-desk-widget-id={ id }
		>
			<div
				className={ styles.contextThumbnailTitle }
				dangerouslySetInnerHTML={ { __html: title } }
			/>
		</article>
	);
}

function getPostTitle(
	postRecord: PostCardRecord | null,
	isResolving: boolean,
	hasError: boolean
) {
	if ( postRecord ) {
		return postRecord.title?.rendered || __( 'Untitled' );
	}

	if ( hasError ) {
		return __( 'Unable to load post' );
	}

	return isResolving ? __( 'Loading post…' ) : __( 'Post unavailable' );
}

function getFeaturedImageUrl( postRecord: PostCardRecord | null ): string | undefined {
	const featured = postRecord?._embedded?.[ 'wp:featuredmedia' ]?.[ 0 ];
	if ( ! featured ) {
		return undefined;
	}

	const sizes = featured.media_details?.sizes ?? {};
	return (
		sizes.medium_large?.source_url ??
		sizes.medium?.source_url ??
		sizes.large?.source_url ??
		featured.source_url
	);
}
