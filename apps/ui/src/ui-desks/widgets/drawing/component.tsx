import { DRAWING_WIDGET_TYPE, type DrawingWidgetProps } from '@/ui-desks/widgets/drawing/types';
import styles from './style.module.css';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type DrawingWidgetComponentProps = DeskWidgetComponentProps< DrawingWidgetProps >;

export function DrawingWidgetComponent( { id, widgetProps }: DrawingWidgetComponentProps ) {
	return (
		<div
			className={ styles.drawing }
			data-studio-desk-widget={ DRAWING_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ widgetProps.svg && (
				<img
					alt=""
					className={ styles.image }
					draggable={ false }
					src={ `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( widgetProps.svg ) }` }
				/>
			) }
		</div>
	);
}
