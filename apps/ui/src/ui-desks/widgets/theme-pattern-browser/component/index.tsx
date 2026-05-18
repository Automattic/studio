import { __, sprintf } from '@wordpress/i18n';
import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { ThemePatternBrowserWidgetProps } from '../types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function ThemePatternBrowserWidgetComponent(
	_props: DeskWidgetComponentProps< ThemePatternBrowserWidgetProps >
) {
	return null;
}

export function ThemePatternBrowserLoadingComponent(
	_props: DeskWidgetLoadingComponentProps< ThemePatternBrowserWidgetProps >
) {
	return (
		<section className={ styles.loading } aria-busy="true">
			<div className={ styles.loadingCard } data-layer="back" aria-hidden="true">
				<LoadingPlaceholder />
			</div>
			<div className={ styles.loadingCard } data-layer="front">
				<LoadingPlaceholder text={ __( 'Loading patterns' ) } />
			</div>
		</section>
	);
}

export function ThemePatternBrowserThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< ThemePatternBrowserWidgetProps > ) {
	return (
		<section className={ styles.thumbnail }>
			<div className={ styles.thumbnailCard } data-layer="back" aria-hidden="true" />
			<div className={ styles.thumbnailCard } data-layer="front">
				<span className={ styles.thumbnailLabel }>{ __( 'Patterns' ) }</span>
				<span className={ styles.thumbnailCount }>
					{ sprintf(
						/* translators: %d: number of patterns. */
						__( '%d cards' ),
						widgetProps.limit
					) }
				</span>
			</div>
		</section>
	);
}
