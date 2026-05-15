import { __, _n, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { type ComponentType, type CSSProperties } from 'react';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import styles from './style.module.css';
import type { DeskWidget, DeskWidgetComponentProps } from '@/ui-desks/widgets/types';

type WidgetThumbnailComponent = ComponentType<
	DeskWidgetComponentProps< Record< string, unknown > >
>;

export const MAX_VISIBLE_CHAT_WIDGETS = 4;

const WIDGET_THUMBNAIL_MAX_SIZE = 72;
const WIDGET_THUMBNAIL_FALLBACK_SIZE = 96;

interface WidgetContextThumbnailListProps {
	widgets: DeskWidget[];
	className?: string;
	ariaLabel?: string;
	maxVisible?: number;
}

export function WidgetContextThumbnailList( {
	widgets,
	className,
	ariaLabel = __( 'Selected widgets' ),
	maxVisible = MAX_VISIBLE_CHAT_WIDGETS,
}: WidgetContextThumbnailListProps ) {
	const visibleWidgets = widgets.slice( 0, maxVisible );
	const hiddenWidgetCount = widgets.length - visibleWidgets.length;

	return (
		<div className={ clsx( styles.thumbnails, className ) } aria-label={ ariaLabel }>
			{ visibleWidgets.map( ( widget ) => (
				<WidgetContextThumbnail key={ widget.id } widget={ widget } />
			) ) }
			{ hiddenWidgetCount > 0 && <WidgetContextMoreThumbnail count={ hiddenWidgetCount } /> }
		</div>
	);
}

export function WidgetContextThumbnail( { widget }: { widget: DeskWidget } ) {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return null;
	}

	const hasCustomThumbnail = Boolean( definition.thumbnail );
	const Thumbnail = ( definition.thumbnail ??
		definition.Component ) as unknown as WidgetThumbnailComponent;
	const geometry = getWidgetThumbnailGeometry( widget, hasCustomThumbnail );
	const frameStyle = {
		width: `${ geometry.width }px`,
		height: `${ geometry.height }px`,
	} satisfies CSSProperties;
	const innerStyle = {
		width: `${ geometry.sourceWidth }px`,
		height: `${ geometry.sourceHeight }px`,
		transform: `translate(-50%, -50%) scale(${ geometry.scale })`,
	} satisfies CSSProperties;
	const label = getWidgetDisplayLabel( widget );

	const thumbnail = (
		<Thumbnail
			id={ widget.id }
			widgetProps={ widget.widgetProps }
			isEditing={ false }
			isHovered={ false }
			isSelected={ false }
			onWidgetPropsChange={ noopWidgetPropsChange }
			onEditComplete={ noopWidgetEditComplete }
		/>
	);

	return (
		<div className={ styles.thumbnail } style={ frameStyle } aria-label={ label } title={ label }>
			{ hasCustomThumbnail ? (
				thumbnail
			) : (
				<div className={ styles.thumbnailInner } style={ innerStyle }>
					{ thumbnail }
				</div>
			) }
		</div>
	);
}

export function WidgetContextMoreThumbnail( { count }: { count: number } ) {
	return (
		<div className={ styles.moreThumbnail } aria-label={ getMoreWidgetsLabel( count ) }>
			{ getMoreWidgetsLabel( count ) }
		</div>
	);
}

export function buildWidgetContextPrompt( userPrompt: string, widgets: DeskWidget[] ) {
	const context = widgets
		.map(
			( widget, index ) =>
				`${ index + 1 }. ${ JSON.stringify( {
					widgetId: widget.id,
					type: widget.type,
					position: {
						x: widget.x,
						y: widget.y,
					},
					widgetProps: widget.widgetProps,
				} ) }`
		)
		.join( '\n' );

	return [
		'Use the following Studio canvas selection as context.',
		'The selected items are canvas widgets. Refer to widget IDs and WordPress entity IDs when helpful.',
		'',
		context,
		'',
		'User request:',
		userPrompt,
	].join( '\n' );
}

export function buildWidgetContextDisplayMessage( userPrompt: string, widgets: DeskWidget[] ) {
	return sprintf(
		/* translators: 1: user prompt, 2: short selected widget summary. */
		__( '%1$s\n\nSelected context: %2$s' ),
		userPrompt,
		summarizeWidgetList( widgets )
	);
}

export function summarizeWidgetList( widgets: DeskWidget[] ) {
	const visibleWidgets = widgets.slice( 0, MAX_VISIBLE_CHAT_WIDGETS );
	const labels = visibleWidgets.map( getWidgetDisplayLabel );
	const hiddenCount = widgets.length - visibleWidgets.length;
	if ( hiddenCount <= 0 ) {
		return labels.join( ', ' );
	}

	return sprintf(
		/* translators: 1: comma-separated selected widget labels, 2: number of additional widgets. */
		_n( '%1$s + %2$d more', '%1$s + %2$d more', hiddenCount ),
		labels.join( ', ' ),
		hiddenCount
	);
}

export function getWidgetDisplayLabel( widget: DeskWidget ) {
	const summary = getWidgetSummary( widget );
	return summary ? `${ getWidgetTypeLabel( widget ) }: ${ summary }` : getWidgetTypeLabel( widget );
}

function getWidgetThumbnailGeometry( widget: DeskWidget, hasCustomThumbnail: boolean ) {
	if ( hasCustomThumbnail ) {
		return {
			sourceWidth: WIDGET_THUMBNAIL_MAX_SIZE,
			sourceHeight: WIDGET_THUMBNAIL_FALLBACK_SIZE,
			scale: 1,
			width: WIDGET_THUMBNAIL_MAX_SIZE,
			height: WIDGET_THUMBNAIL_FALLBACK_SIZE,
		};
	}

	const sourceWidth = getThumbnailSourceSize( widget.shapeProps.w );
	const sourceHeight = getThumbnailSourceSize( widget.shapeProps.h );
	const scale = Math.min( 1, WIDGET_THUMBNAIL_MAX_SIZE / Math.max( sourceWidth, sourceHeight ) );

	return {
		sourceWidth,
		sourceHeight,
		scale,
		width: WIDGET_THUMBNAIL_MAX_SIZE,
		height: WIDGET_THUMBNAIL_FALLBACK_SIZE,
	};
}

function getThumbnailSourceSize( value: number ) {
	if ( value < 24 ) {
		return WIDGET_THUMBNAIL_FALLBACK_SIZE;
	}

	return value;
}

function getMoreWidgetsLabel( count: number ) {
	return sprintf(
		/* translators: %d: number of additional selected widgets. */
		__( '+%d more' ),
		count
	);
}

function getWidgetTypeLabel( widget: DeskWidget ) {
	return getWidgetDefinition( widget.type )?.name() ?? widget.type;
}

function getWidgetSummary( widget: DeskWidget ) {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition || ! definition.isWidgetProps( widget.widgetProps ) ) {
		return '';
	}

	const getSummary = definition.getSummary as
		| ( ( widgetProps: DeskWidget[ 'widgetProps' ] ) => string )
		| undefined;

	return getSummary?.( widget.widgetProps ) ?? '';
}

function noopWidgetPropsChange() {}
function noopWidgetEditComplete() {}
