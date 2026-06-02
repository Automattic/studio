import { useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	isRectangleWidgetShapeProps,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { NOTE_WIDGET_TYPE, type NoteTone } from '@/ui-desks/widgets/note/types';
import type { DeskConfig } from '@/ui-desks/desk/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export interface DeskWidgetConnectionTarget {
	shapeId: TLShapeId;
	widget: DeskWidget;
	label: string;
	title: string;
	pillBg?: string;
}

export function useIncomingWidgetConnections(
	editor: Editor,
	targetShapeId: TLShapeId | undefined
): DeskWidgetConnectionTarget[] {
	return useValue(
		`incoming-widget-connections:${ targetShapeId ?? 'none' }`,
		() => ( targetShapeId ? getIncomingWidgetConnections( editor, targetShapeId ) : [] ),
		[ editor, targetShapeId ]
	);
}

export function getIncomingWidgetConnections(
	editor: Editor,
	targetShapeId: TLShapeId
): DeskWidgetConnectionTarget[] {
	const sources: DeskWidgetConnectionTarget[] = [];
	for ( const binding of editor.getBindingsToShape( targetShapeId, 'arrow' ) ) {
		if ( getArrowBindingTerminal( binding.props ) !== 'end' ) {
			continue;
		}

		const connectorShape = editor.getShape( binding.fromId );
		if ( ! isDeskConnectorCanvasShape( connectorShape ) ) {
			continue;
		}

		const startBinding = editor
			.getBindingsFromShape( connectorShape.id, 'arrow' )
			.find( ( candidate ) => getArrowBindingTerminal( candidate.props ) === 'start' );
		if ( ! startBinding ) {
			continue;
		}

		const sourceShape = editor.getShape( startBinding.toId );
		const widget = sourceShape ? canvasShapeToDeskWidgetForContext( sourceShape ) : null;
		if ( ! sourceShape || ! widget ) {
			continue;
		}

		const label = getDeskWidgetConnectionLabel( widget );
		sources.push( {
			shapeId: sourceShape.id,
			widget,
			label,
			title: getDeskWidgetConnectionTitle( widget, label ),
			pillBg: getDeskWidgetConnectionPillBg( widget ),
		} );
	}
	return sources;
}

export function focusOnDeskShape( editor: Editor, shapeId: TLShapeId ) {
	editor.setSelectedShapes( [ shapeId ] );
	const bounds = editor.getShapePageBounds( shapeId );
	if ( ! bounds ) {
		return false;
	}

	editor.centerOnPoint( bounds.center, { animation: { duration: 320 } } );
	editor.focus();
	return true;
}

export function appendIncomingConnectedWidgets(
	widgets: DeskWidget[],
	deskConfig: DeskConfig | null | undefined
): DeskWidget[] {
	if ( widgets.length === 0 || ! deskConfig?.connectors?.length ) {
		return widgets;
	}

	const widgetsById = new Map( deskConfig.widgets.map( ( widget ) => [ widget.id, widget ] ) );
	const selectedIds = new Set( widgets.map( ( widget ) => widget.id ) );
	const output = [ ...widgets ];

	for ( const widget of widgets ) {
		for ( const connector of deskConfig.connectors ) {
			if ( connector.to.widgetId !== widget.id || selectedIds.has( connector.from.widgetId ) ) {
				continue;
			}

			const sourceWidget = widgetsById.get( connector.from.widgetId );
			if ( ! sourceWidget ) {
				continue;
			}

			selectedIds.add( sourceWidget.id );
			output.push( sourceWidget );
		}
	}

	return output;
}

export function getDeskWidgetConnectionLabel( widget: DeskWidget ) {
	const props = widget.widgetProps as Record< string, unknown >;
	switch ( widget.type as string ) {
		case 'post':
			return typeof props.postId === 'number' ? `Post #${ props.postId }` : 'Post';
		case 'page':
			return typeof props.pageId === 'number' ? `Page #${ props.pageId }` : 'Page';
		case NOTE_WIDGET_TYPE:
			return 'Note';
		case 'site-preview':
			return typeof props.path === 'string' && props.path ? props.path : 'Preview';
		case 'site-card':
			return 'Site card';
		case 'bookmark':
		case 'embed':
			return getUrlHostLabel( props.url ) ?? ( widget.type === 'embed' ? 'Embed' : 'Bookmark' );
		case 'media':
			return typeof props.mediaKind === 'string' && props.mediaKind === 'video' ? 'Video' : 'Image';
		case 'drawing':
			return 'Drawing';
		case 'scratchpad':
			return typeof props.title === 'string' && props.title ? props.title : 'Scratchpad';
		case 'blog':
			return 'Blog';
		case 'post-collection':
			return 'Posts';
		default:
			return widget.type;
	}
}

export function getDeskWidgetConnectionTitle(
	widget: DeskWidget,
	label = getDeskWidgetConnectionLabel( widget )
) {
	const props = widget.widgetProps as Record< string, unknown >;
	if ( widget.type === 'media' ) {
		const alt = typeof props.alt === 'string' ? props.alt.trim() : '';
		return alt || label;
	}

	if ( widget.type === NOTE_WIDGET_TYPE ) {
		const text = typeof props.text === 'string' ? stripMarkup( props.text ).trim() : '';
		return text || label;
	}

	return label;
}

export function getDeskWidgetConnectionPillBg( widget: DeskWidget ) {
	if ( widget.type !== NOTE_WIDGET_TYPE ) {
		return undefined;
	}

	const tone = ( widget.widgetProps as { tone?: unknown } ).tone;
	return NOTE_CONNECTION_PILL_BG[ tone as NoteTone ];
}

const NOTE_CONNECTION_PILL_BG: Record< NoteTone, string > = {
	grey: '#6b7280',
	yellow: '#c4a300',
	mint: '#3ca56f',
	blue: '#2271b1',
	orange: '#c97223',
	violet: '#7b3fb6',
	'neon-yellow': '#a18a00',
	'neon-green': '#2e9e3a',
	'neon-violet': '#6f2daa',
	'neon-orange': '#b97917',
	'neon-blue': '#1873c9',
};

function canvasShapeToDeskWidgetForContext( shape: TLShape ): DeskWidget | null {
	if ( shape.type !== RECTANGLE_WIDGET_SHAPE_TYPE ) {
		return null;
	}

	const props = shape.props as Partial< {
		widgetType: unknown;
		shapeProps: unknown;
		widgetProps: unknown;
	} >;
	if (
		typeof props.widgetType !== 'string' ||
		! isRectangleWidgetShapeProps( props.shapeProps ) ||
		! props.widgetProps ||
		typeof props.widgetProps !== 'object'
	) {
		return null;
	}

	return {
		id: getWidgetIdFromShapeId( shape.id ),
		type: props.widgetType,
		x: shape.x,
		y: shape.y,
		rotation: shape.rotation || undefined,
		zIndex: String( shape.index ?? 'a1' ),
		shapeProps: props.shapeProps,
		widgetProps: props.widgetProps as Record< string, unknown >,
	} as DeskWidget;
}

function isDeskConnectorCanvasShape( shape: unknown ): shape is TLShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as Partial< TLShape > ).type === 'arrow' &&
		( ( shape as Partial< TLShape > ).meta as { studioDeskConnector?: unknown } | undefined )
			?.studioDeskConnector === true
	);
}

function getArrowBindingTerminal( props: object ) {
	return ( props as { terminal?: unknown } ).terminal;
}

function getUrlHostLabel( value: unknown ) {
	if ( typeof value !== 'string' || ! value ) {
		return null;
	}

	try {
		return new URL( value ).hostname.replace( /^www\./, '' );
	} catch {
		return value;
	}
}

function getWidgetIdFromShapeId( shapeId: string ) {
	return shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
}

function stripMarkup( value: string ) {
	return value
		.replace( /<[^>]*>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}
