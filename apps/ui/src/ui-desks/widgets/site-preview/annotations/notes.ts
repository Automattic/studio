import { getIndexAbove, sortByIndex, type TLShapePartial } from 'tldraw';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import type { AnnotationPayload } from './inspector';
import type { DeskSitePreviewAnnotation } from './prompt';
import type { DeskConnector } from '@/ui-desks/desk/types';
import type { DeskFocusDesk } from '@/ui-desks/focus-mode/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

const ANNOTATION_NOTE_WIDTH = 220;
const ANNOTATION_NOTE_HEIGHT = 140;
const ANNOTATION_NOTE_GAP_HORIZONTAL = 160;
const ANNOTATION_NOTE_GAP_VERTICAL = 40;
const SITE_PREVIEW_FRAME_SCALE = 0.75;
const ANNOTATION_CONNECTOR_BEND = 72;

type AnnotationEdge = 'left' | 'right' | 'bottom';

export interface AnnotationFocusEntry {
	widget: DeskWidget;
	connector: DeskConnector;
}

export function createAnnotationFocusEntry(
	rootWidget: DeskWidget,
	payload: AnnotationPayload,
	comment: string,
	focusDesk: DeskFocusDesk
): AnnotationFocusEntry | null {
	const rootSize = getWidgetSize( rootWidget );
	if ( ! rootSize ) {
		return null;
	}

	const frameCenterX =
		( payload.boundingBox.left + payload.boundingBox.width / 2 ) * SITE_PREVIEW_FRAME_SCALE;
	const frameCenterY =
		( payload.boundingBox.top + payload.boundingBox.height / 2 ) * SITE_PREVIEW_FRAME_SCALE;
	const fx = clamp01( frameCenterX / rootSize.w );
	const fy = clamp01( frameCenterY / rootSize.h );
	const slot = pickAnnotationSlot(
		{
			x: rootWidget.x,
			y: rootWidget.y,
			w: rootSize.w,
			h: rootSize.h,
		},
		fx,
		fy,
		ANNOTATION_NOTE_WIDTH,
		ANNOTATION_NOTE_HEIGHT,
		focusDesk.widgets.filter( isAnnotationWidget ).map( ( widget ) => ( {
			x: widget.x,
			y: widget.y,
		} ) )
	);
	const widgetId = createAnnotationWidgetId();
	const widget: DeskWidget = {
		id: widgetId,
		type: NOTE_WIDGET_TYPE,
		x: slot.x,
		y: slot.y,
		zIndex: getNextZIndex( [ rootWidget, ...focusDesk.widgets ] ),
		shapeProps: {
			w: ANNOTATION_NOTE_WIDTH,
			h: ANNOTATION_NOTE_HEIGHT,
		},
		widgetProps: {
			text: comment ? `<p>${ escapeHtml( comment ) }</p>` : '',
			tone: 'grey',
			annotation: {
				...payload,
				previewWidgetId: rootWidget.id,
			},
		} satisfies NoteWidgetProps,
	};
	const connector: DeskConnector = {
		id: `annotation-connector-${ widgetId }`,
		from: {
			widgetId: rootWidget.id,
			normalizedAnchor: { x: fx, y: fy },
		},
		to: {
			widgetId,
			normalizedAnchor: { x: 0.5, y: 0.5 },
		},
		bend: ANNOTATION_CONNECTOR_BEND,
	};

	return { widget, connector };
}

export function removeAnnotationWidget(
	focusDesk: DeskFocusDesk,
	widgetId: string
): DeskFocusDesk {
	return {
		...focusDesk,
		widgets: focusDesk.widgets.filter( ( widget ) => widget.id !== widgetId ),
		connectors: ( focusDesk.connectors ?? [] ).filter(
			( connector ) => connector.from.widgetId !== widgetId && connector.to.widgetId !== widgetId
		),
	};
}

export function getAnnotationWidgets( focusDesk: DeskFocusDesk ) {
	return focusDesk.widgets.filter( isAnnotationWidget );
}

export function getAnnotationSubmission(
	rootWidget: DeskWidget | null,
	focusDesk: DeskFocusDesk | null
): { annotations: DeskSitePreviewAnnotation[]; previewWidget?: DeskWidget } | null {
	if ( ! focusDesk ) {
		return null;
	}

	const annotations = getAnnotationWidgets( focusDesk )
		.map( ( widget ): DeskSitePreviewAnnotation | null => {
			const props = widget.widgetProps as Partial< NoteWidgetProps >;
			const annotation = props.annotation;
			const comment = typeof props.text === 'string' ? stripHtmlToText( props.text ).trim() : '';
			if ( ! annotation || ! comment ) {
				return null;
			}
			return {
				id: widget.id,
				comment,
				selector: annotation.selector,
				tag: annotation.tag,
				nearbyText: annotation.nearbyText,
				url: annotation.url,
				pathname: annotation.pathname,
				timestamp: annotation.timestamp,
				displayName: annotation.displayName,
				boundingBox: annotation.boundingBox,
			};
		} )
		.filter( ( annotation ): annotation is DeskSitePreviewAnnotation => annotation !== null );

	if ( annotations.length === 0 ) {
		return null;
	}

	return { annotations, previewWidget: rootWidget ?? undefined };
}

function isAnnotationWidget( widget: DeskWidget ) {
	if ( widget.type !== NOTE_WIDGET_TYPE ) {
		return false;
	}
	const props = widget.widgetProps as Partial< NoteWidgetProps >;
	return Boolean( props.annotation );
}

function getWidgetSize( widget: DeskWidget ) {
	const shapeProps = widget.shapeProps as Partial< { w: unknown; h: unknown } >;
	if ( typeof shapeProps.w !== 'number' || typeof shapeProps.h !== 'number' ) {
		return null;
	}
	return { w: shapeProps.w, h: shapeProps.h };
}

function positionForEdge(
	rootBounds: { x: number; y: number; w: number; h: number },
	edge: AnnotationEdge,
	fx: number,
	fy: number,
	width: number,
	height: number
) {
	if ( edge === 'left' ) {
		return {
			x: rootBounds.x - width - ANNOTATION_NOTE_GAP_HORIZONTAL,
			y: rootBounds.y + fy * rootBounds.h - height / 2,
		};
	}

	if ( edge === 'right' ) {
		return {
			x: rootBounds.x + rootBounds.w + ANNOTATION_NOTE_GAP_HORIZONTAL,
			y: rootBounds.y + fy * rootBounds.h - height / 2,
		};
	}

	return {
		x: rootBounds.x + fx * rootBounds.w - width / 2,
		y: rootBounds.y + rootBounds.h + ANNOTATION_NOTE_GAP_VERTICAL,
	};
}

function pickAnnotationSlot(
	rootBounds: { x: number; y: number; w: number; h: number },
	fx: number,
	fy: number,
	width: number,
	height: number,
	existing: Array< { x: number; y: number } >
) {
	const primary: AnnotationEdge = fx < 0.5 ? 'left' : 'right';
	const secondary: AnnotationEdge = primary === 'left' ? 'right' : 'left';
	const order: AnnotationEdge[] = [ primary, secondary, 'bottom' ];

	for ( const edge of order ) {
		const position = positionForEdge( rootBounds, edge, fx, fy, width, height );
		if ( ! overlapsExisting( position, existing, width, height ) ) {
			return position;
		}
	}

	const seed = positionForEdge( rootBounds, primary, fx, fy, width, height );
	let y = seed.y;
	let safety = 100;
	while ( safety > 0 ) {
		const position = { x: seed.x, y };
		if ( ! overlapsExisting( position, existing, width, height ) ) {
			return position;
		}
		y += height + 16;
		safety -= 1;
	}

	return seed;
}

function overlapsExisting(
	position: { x: number; y: number },
	existing: Array< { x: number; y: number } >,
	width: number,
	height: number,
	padding = 16
) {
	return existing.some(
		( other ) =>
			Math.abs( other.x - position.x ) < width + padding &&
			Math.abs( other.y - position.y ) < height + padding
	);
}

function getNextZIndex( widgets: DeskWidget[] ) {
	const highestWidget = [ ...widgets ]
		.sort( ( first, second ) =>
			sortByIndex( { index: first.zIndex as never }, { index: second.zIndex as never } )
		)
		.at( -1 );
	return getIndexAbove( ( highestWidget?.zIndex ?? null ) as TLShapePartial[ 'index' ] | null );
}

function createAnnotationWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `annotation-${ Date.now().toString( 36 ) }`;
}

function stripHtmlToText( html: string ) {
	if ( typeof document === 'undefined' ) {
		return html;
	}

	const element = document.createElement( 'div' );
	element.innerHTML = html;
	element.querySelectorAll( 'p, br, div, li' ).forEach( ( child ) => {
		child.insertAdjacentText( 'beforebegin', '\n' );
	} );
	return ( element.textContent || '' ).replace( /\n{2,}/g, '\n' ).trim();
}

function escapeHtml( value: string ) {
	return value
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' );
}

function clamp01( value: number ) {
	if ( Number.isNaN( value ) ) {
		return 0;
	}
	if ( value < 0 ) {
		return 0;
	}
	if ( value > 1 ) {
		return 1;
	}
	return value;
}
