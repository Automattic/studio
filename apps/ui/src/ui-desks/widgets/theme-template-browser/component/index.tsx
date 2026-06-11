import { __ } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { ThemeTemplateBrowserWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function ThemeTemplateBrowserWidgetComponent(
	_props: DeskWidgetComponentProps< ThemeTemplateBrowserWidgetProps >
) {
	return null;
}

export function ThemeTemplateBrowserLoadingComponent(
	_props: DeskWidgetLoadingComponentProps< ThemeTemplateBrowserWidgetProps >
) {
	return (
		<section className={ styles.loading } aria-busy="true">
			<div className={ styles.loadingCard } data-layer="back" aria-hidden="true">
				<LoadingPlaceholder />
			</div>
			<div className={ styles.loadingCard } data-layer="front">
				<LoadingPlaceholder text={ __( 'Loading templates' ) } />
			</div>
		</section>
	);
}

export function ThemeTemplateBrowserThumbnailComponent(
	_props: DeskWidgetThumbnailComponentProps< ThemeTemplateBrowserWidgetProps >
) {
	return (
		<section className={ styles.thumbnail }>
			<div className={ styles.thumbnailCard } data-layer="back" aria-hidden="true" />
			<div className={ styles.thumbnailCard } data-layer="front">
				<span className={ styles.thumbnailLabel }>{ __( 'Templates' ) }</span>
				<span className={ styles.thumbnailCount }>{ __( 'Theme hierarchy' ) }</span>
			</div>
		</section>
	);
}
