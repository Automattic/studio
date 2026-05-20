import { DRAWING_WIDGET_TYPE, type DrawingWidgetProps } from '@/ui-desks/widgets/drawing/types';
import styles from './style.module.css';
import type {
	DeskWidgetComponentProps,
	DeskWidgetThumbnailComponentProps,
} from '@/ui-desks/widgets/types';
import type { CSSProperties } from 'react';

type DrawingWidgetComponentProps = DeskWidgetComponentProps< DrawingWidgetProps >;
const SELECTED_DRAWING_COLOR = '#6b7280';

export function DrawingWidgetComponent( {
	id,
	isSelected,
	widgetProps,
}: DrawingWidgetComponentProps ) {
	const svgSource = widgetProps.svg
		? `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( widgetProps.svg ) }`
		: null;
	const selectedImageStyle: CSSProperties | undefined = svgSource
		? {
				WebkitMaskImage: `url("${ svgSource }")`,
				maskImage: `url("${ svgSource }")`,
		  }
		: undefined;

	return (
		<div
			className={ styles.drawing }
			data-studio-desk-widget={ DRAWING_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ svgSource && (
				<>
					<img alt="" className={ styles.image } draggable={ false } src={ svgSource } />
					{ isSelected && (
						<div
							aria-hidden="true"
							className={ styles.selectedImage }
							style={ {
								...selectedImageStyle,
								backgroundColor: SELECTED_DRAWING_COLOR,
							} }
						/>
					) }
				</>
			) }
		</div>
	);
}

export function DrawingWidgetThumbnailComponent( {
	id,
	widgetProps,
}: DeskWidgetThumbnailComponentProps< DrawingWidgetProps > ) {
	const svgSource = widgetProps.svg
		? `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( widgetProps.svg ) }`
		: null;

	return (
		<div
			className={ styles.thumbnail }
			data-studio-desk-widget={ DRAWING_WIDGET_TYPE }
			data-studio-desk-widget-id={ id }
		>
			{ svgSource && (
				<img alt="" className={ styles.thumbnailImage } draggable={ false } src={ svgSource } />
			) }
		</div>
	);
}
