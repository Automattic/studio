import { useEntityRecords, type Post as CoreDataPost } from '@wordpress/core-data';
import { __, _n, sprintf } from '@wordpress/i18n';
import { comment } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useMemo } from 'react';
import { LoadingPlaceholder } from '@/ui-desks/components';
import { getPostStatusInfo } from '@/ui-desks/widgets/post-status';
import styles from './style.module.css';
import { useCommentCount } from './use-comment-count';
import type { PostWidgetProps } from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type PostWidgetComponentProps = DeskWidgetComponentProps< PostWidgetProps >;
type EmbeddedFeaturedMedia = {
	source_url?: string;
	media_details?: {
		sizes?: Record< string, { source_url?: string } >;
	};
};
type PostCardRecord = CoreDataPost & {
	status?: string;
	_embedded?: {
		'wp:featuredmedia'?: EmbeddedFeaturedMedia[];
	};
};

export function PostWidgetComponent( { id, widgetProps }: PostWidgetComponentProps ) {
	const query = useMemo(
		() => ( {
			include: [ widgetProps.postId ],
			per_page: 1,
			context: 'edit',
			_embed: true,
			_fields: 'id,title,excerpt,status,featured_media,_links,_embedded',
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
	const statusInfo = getPostStatusInfo( record?.status );
	const showMetadata = Boolean( record?.status || commentCount > 0 );

	return (
		<article
			className={ styles.post }
			data-is-loading="false"
			data-studio-desk-widget="post"
			data-studio-desk-widget-id={ id }
		>
			<h2 className={ styles.title } dangerouslySetInnerHTML={ { __html: title } } />
			{ showFeaturedImage && featuredImage ? (
				<img className={ styles.featuredImage } src={ featuredImage } alt="" draggable={ false } />
			) : excerpt ? (
				<div className={ styles.body } dangerouslySetInnerHTML={ { __html: excerpt } } />
			) : null }
			{ showMetadata && (
				<div className={ styles.metadata }>
					{ record?.status && (
						<span className={ styles.status } title={ statusInfo.label }>
							<span
								className={ styles.statusDot }
								style={ { background: statusInfo.color } }
								aria-hidden="true"
							/>
							<span className={ styles.statusLabel }>{ statusInfo.label }</span>
						</span>
					) }
					{ commentCount > 0 && (
						<span
							className={ styles.comments }
							aria-label={ sprintf(
								_n( '%d comment', '%d comments', commentCount ),
								commentCount
							) }
						>
							<Icon icon={ comment } />
							<span>{ commentCount }</span>
						</span>
					) }
				</div>
			) }
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
