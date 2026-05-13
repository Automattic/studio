import { LoadingPlaceholder } from '@/ui-desks/components';
import styles from './style.module.css';
import type { LoadingWidgetProps } from './types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';

export function LoadingWidgetComponent( {
	widgetProps,
}: DeskWidgetComponentProps< LoadingWidgetProps > ) {
	return (
		<section className={ styles.loading } aria-busy="true">
			<LoadingPlaceholder text={ widgetProps.label } />
		</section>
	);
}

export function LoadingWidgetThumbnailComponent( {
	widgetProps,
}: DeskWidgetThumbnailComponentProps< LoadingWidgetProps > ) {
	return (
		<section className={ styles.thumbnail } aria-busy="true">
			<LoadingPlaceholder text={ widgetProps.label } />
		</section>
	);
}
