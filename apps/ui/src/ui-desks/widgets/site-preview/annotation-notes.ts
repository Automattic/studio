import { RichTextData } from '@wordpress/rich-text';
import {
	createShapeId,
	getIndexAbove,
	sortByIndex,
	type Editor,
	type TLArrowShape,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw';
import {
	CONNECTOR_COLOR,
	CONNECTOR_DASH,
	CONNECTOR_DEFAULT_BEND,
	canvasShapeToDeskWidget,
	deskWidgetToCanvasShape,
	getTemporaryDeskCanvasRecordMeta,
} from '@/ui-desks/desk/tldraw-adapter';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { createDeskWidget } from '@/ui-desks/widget-actions/create-widget';
import { NOTE_WIDGET_TYPE, type NoteWidgetProps } from '@/ui-desks/widgets/note/types';
import { SITE_PREVIEW_WIDGET_TYPE } from './types';
import type { AnnotationPayload } from './annotation-inspector';
import type { Annotation } from '@/components/site-preview/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

const ANNOTATION_NOTE_WIDTH = 220;
const ANNOTATION_NOTE_HEIGHT = 140;
const ANNOTATION_NOTE_GAP_HORIZONTAL = 160;
const ANNOTATION_NOTE_GAP_VERTICAL = 40;
const SITE_PREVIEW_FRAME_SCALE = 0.75;

interface AnnotationConnectorMeta {
	studioDeskAnnotationConnector?: boolean;
}

type AnnotationEdge = 'left' | 'right' | 'bottom';

type ShapeBounds = NonNullable< ReturnType< Editor[ 'getShapePageBounds' ] > >;

export function createAnnotationNote(
	editor: Editor,
	previewShape: RectangleWidgetShape,
	payload: AnnotationPayload,
	comment: string
): TLShapeId | null {
	const previewBounds = editor.getShapePageBounds( previewShape.id );
	if ( ! previewBounds ) {
		return null;
	}

	const previewSize = previewShape.props.shapeProps;
	const frameCenterX =
		( payload.boundingBox.left + payload.boundingBox.width / 2 ) * SITE_PREVIEW_FRAME_SCALE;
	const frameCenterY =
		( payload.boundingBox.top + payload.boundingBox.height / 2 ) * SITE_PREVIEW_FRAME_SCALE;
	const fx = clamp01( frameCenterX / previewSize.w );
	const fy = clamp01( frameCenterY / previewSize.h );
	const existing = getAnnotationNoteShapes( editor, previewShape.id ).map( ( shape ) => ( {
		x: shape.x,
		y: shape.y,
	} ) );
	const slot = pickAnnotationSlot(
		previewBounds,
		fx,
		fy,
		ANNOTATION_NOTE_WIDTH,
		ANNOTATION_NOTE_HEIGHT,
		existing
	);
	const widget = createDeskWidget( {
		id: createAnnotationWidgetId(),
		type: NOTE_WIDGET_TYPE,
		center: {
			x: slot.x + ANNOTATION_NOTE_WIDTH / 2,
			y: slot.y + ANNOTATION_NOTE_HEIGHT / 2,
		},
		zIndex: getNextZIndex( editor.getCurrentPageShapes() ),
		shapeProps: {
			w: ANNOTATION_NOTE_WIDTH,
			h: ANNOTATION_NOTE_HEIGHT,
		},
		widgetProps: {
			text: comment ? `<p>${ escapeHtml( comment ) }</p>` : '',
			tone: 'grey',
			annotation: {
				...payload,
				previewShapeId: previewShape.id,
			},
		} satisfies NoteWidgetProps,
	} );

	if ( ! widget ) {
		return null;
	}

	const canvasShape = deskWidgetToCanvasShape( widget ) as TLShapePartial< RectangleWidgetShape >;
	const noteShape: TLShapePartial< RectangleWidgetShape > = {
		...canvasShape,
		meta: getTemporaryDeskCanvasRecordMeta( null ),
	};
	const noteShapeId = noteShape.id as TLShapeId | undefined;
	if ( ! noteShapeId ) {
		return null;
	}

	editor.createShape< RectangleWidgetShape >( noteShape );
	createAnnotationConnector( editor, previewShape.id, noteShapeId, previewBounds, {
		x: slot.x + ANNOTATION_NOTE_WIDTH / 2,
		y: slot.y + ANNOTATION_NOTE_HEIGHT / 2,
	} );

	return noteShapeId;
}

export function getAnnotationNoteShapes( editor: Editor, previewShapeId: TLShapeId ) {
	return editor
		.getCurrentPageShapes()
		.filter( isRectangleWidgetShape )
		.filter( ( shape ) => {
			if ( shape.props.widgetType !== NOTE_WIDGET_TYPE ) {
				return false;
			}
			const props = shape.props.widgetProps as Partial< NoteWidgetProps >;
			return props.annotation?.previewShapeId === previewShapeId;
		} )
		.sort( sortByIndex );
}

export function getSelectedAnnotationNoteShapeId(
	editor: Editor,
	previewShapeId: TLShapeId
): TLShapeId | null {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length !== 1 ) {
		return null;
	}

	const [ selectedShapeId ] = selectedShapeIds;
	const shape = editor.getShape( selectedShapeId );
	if ( ! shape || ! isRectangleWidgetShape( shape ) ) {
		return null;
	}

	const props = shape.props.widgetProps as Partial< NoteWidgetProps >;
	return props.annotation?.previewShapeId === previewShapeId ? selectedShapeId : null;
}

export function deleteAnnotationNotes(
	editor: Editor,
	previewShapeId: TLShapeId,
	noteShapeIds = getAnnotationNoteShapes( editor, previewShapeId ).map( ( shape ) => shape.id )
) {
	const existingNoteShapeIds = noteShapeIds.filter( ( shapeId ) =>
		Boolean( editor.getShape( shapeId ) )
	);
	const connectorIds = getAnnotationConnectorIds( editor, previewShapeId, existingNoteShapeIds );
	if ( connectorIds.length > 0 || existingNoteShapeIds.length > 0 ) {
		editor.deleteShapes( [ ...connectorIds, ...existingNoteShapeIds ] );
	}
}

export function getAnnotationSubmission(
	editor: Editor,
	previewShapeId: TLShapeId
): { annotations: Annotation[]; previewWidget?: DeskWidget } | null {
	const previewShape = editor.getShape( previewShapeId );
	const previewWidget = previewShape
		? canvasShapeToDeskWidget( previewShape ) ?? undefined
		: undefined;
	const annotations = getAnnotationNoteShapes( editor, previewShapeId )
		.map( ( shape ): Annotation | null => {
			const widget = canvasShapeToDeskWidget( shape );
			const props = shape.props.widgetProps as Partial< NoteWidgetProps >;
			const annotation = props.annotation;
			const comment = typeof props.text === 'string' ? stripHtmlToText( props.text ).trim() : '';
			if ( ! widget || ! annotation || ! comment ) {
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
			} as Annotation;
		} )
		.filter( ( annotation ): annotation is Annotation => annotation !== null );

	if ( annotations.length === 0 ) {
		return null;
	}

	return { annotations, previewWidget };
}

export function isAnnotationConnectorShape( shape: unknown ): shape is TLArrowShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as Partial< TLShape > ).type === 'arrow' &&
		( ( shape as Partial< TLShape > ).meta as AnnotationConnectorMeta | undefined )
			?.studioDeskAnnotationConnector === true
	);
}

function createAnnotationConnector(
	editor: Editor,
	previewShapeId: TLShapeId,
	noteShapeId: TLShapeId,
	previewBounds: ShapeBounds,
	noteCenter: { x: number; y: number }
) {
	const arrowId = createShapeId(
		`annotation-connector-${ createAnnotationWidgetId() }`
	) as TLArrowShape[ 'id' ];
	editor.createShape< TLArrowShape >( {
		id: arrowId,
		type: 'arrow',
		meta: {
			...( getTemporaryDeskCanvasRecordMeta( null ) ?? {} ),
			studioDeskAnnotationConnector: true,
		},
		props: {
			kind: 'arc',
			color: CONNECTOR_COLOR,
			dash: CONNECTOR_DASH,
			size: 'm',
			bend: CONNECTOR_DEFAULT_BEND,
			arrowheadStart: 'dot',
			arrowheadEnd: 'arrow',
			start: { x: previewBounds.center.x, y: previewBounds.center.y },
			end: noteCenter,
		},
	} );
	editor.createBindings( [
		{
			type: 'arrow' as const,
			fromId: arrowId,
			toId: previewShapeId,
			props: {
				terminal: 'start' as const,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
		{
			type: 'arrow' as const,
			fromId: arrowId,
			toId: noteShapeId,
			props: {
				terminal: 'end' as const,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
	] );
}

function getAnnotationConnectorIds(
	editor: Editor,
	previewShapeId: TLShapeId,
	noteShapeIds: TLShapeId[]
): TLShapeId[] {
	const noteShapeIdSet = new Set( noteShapeIds );
	return editor
		.getCurrentPageShapes()
		.filter( isAnnotationConnectorShape )
		.filter( ( shape ) => {
			const bindings = editor.getBindingsFromShape( shape.id, 'arrow' );
			const startBinding = bindings.find(
				( binding ) => getArrowBindingTerminal( binding.props ) === 'start'
			);
			const endBinding = bindings.find(
				( binding ) => getArrowBindingTerminal( binding.props ) === 'end'
			);
			return (
				startBinding?.toId === previewShapeId &&
				Boolean( endBinding && noteShapeIdSet.has( endBinding.toId ) )
			);
		} )
		.map( ( shape ) => shape.id );
}

function getArrowBindingTerminal( props: object ) {
	return ( props as { terminal?: unknown } ).terminal;
}

function positionForEdge(
	previewBounds: ShapeBounds,
	edge: AnnotationEdge,
	fx: number,
	fy: number,
	width: number,
	height: number
) {
	if ( edge === 'left' ) {
		return {
			x: previewBounds.minX - width - ANNOTATION_NOTE_GAP_HORIZONTAL,
			y: previewBounds.minY + fy * previewBounds.h - height / 2,
		};
	}

	if ( edge === 'right' ) {
		return {
			x: previewBounds.maxX + ANNOTATION_NOTE_GAP_HORIZONTAL,
			y: previewBounds.minY + fy * previewBounds.h - height / 2,
		};
	}

	return {
		x: previewBounds.minX + fx * previewBounds.w - width / 2,
		y: previewBounds.maxY + ANNOTATION_NOTE_GAP_VERTICAL,
	};
}

function pickAnnotationSlot(
	previewBounds: ShapeBounds,
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
		const position = positionForEdge( previewBounds, edge, fx, fy, width, height );
		if ( ! overlapsExisting( position, existing, width, height ) ) {
			return position;
		}
	}

	const seed = positionForEdge( previewBounds, primary, fx, fy, width, height );
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

function getNextZIndex( shapes: TLShape[] ) {
	const highestShape = [ ...shapes ].sort( sortByIndex ).at( -1 );
	return getIndexAbove( highestShape?.index ?? null );
}

function createAnnotationWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `annotation-${ Date.now().toString( 36 ) }`;
}

function isRectangleWidgetShape( shape: unknown ): shape is RectangleWidgetShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as Partial< TLShape > ).type === RECTANGLE_WIDGET_SHAPE_TYPE &&
		( ( shape as Partial< RectangleWidgetShape > ).props?.widgetType === NOTE_WIDGET_TYPE ||
			( shape as Partial< RectangleWidgetShape > ).props?.widgetType === SITE_PREVIEW_WIDGET_TYPE )
	);
}

function stripHtmlToText( html: string ) {
	if ( typeof document === 'undefined' ) {
		return RichTextData.fromHTMLString( html ).toPlainText();
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
