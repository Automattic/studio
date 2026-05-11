import { __, sprintf } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { PostCollectionWidgetProps } from './types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function PostCollectionWidgetComponent(
	_props: DeskWidgetComponentProps< PostCollectionWidgetProps >
) {
	return null;
}

export function PostCollectionLoadingComponent(
	_props: DeskWidgetLoadingComponentProps< PostCollectionWidgetProps >
) {
	return (
		<section className={ styles.loading } aria-busy="true">
			<div className={ styles.loadingCard } data-layer="back" aria-hidden="true">
				<LoadingPlaceholder />
			</div>
			<div className={ styles.loadingCard } data-layer="front">
				<LoadingPlaceholder text={ __( 'Loading posts' ) } />
			</div>
		</section>
	);
}

export function PostCollectionThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< PostCollectionWidgetProps > ) {
	return (
		<section className={ styles.thumbnail }>
			<div className={ styles.thumbnailCard } data-layer="back" aria-hidden="true" />
			<div className={ styles.thumbnailCard } data-layer="front">
				<span className={ styles.thumbnailLabel }>{ __( 'Posts' ) }</span>
				<span className={ styles.thumbnailCount }>
					{ sprintf(
						/* translators: 1: number of posts, 2: post status. */
						__( '%1$d %2$s' ),
						widgetProps.query.perPage,
						widgetProps.query.status
					) }
				</span>
			</div>
		</section>
	);
}
