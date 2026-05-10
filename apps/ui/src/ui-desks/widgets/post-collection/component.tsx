import { __ } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { PostCollectionWidgetProps } from './types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
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
