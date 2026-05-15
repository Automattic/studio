import { RichTextData } from '@wordpress/rich-text';
import { sortByIndex, useValue, type Editor, type TLShape, type TLShapeId } from 'tldraw';
import {
	canvasShapeToDeskWidget,
	isDeskConnectorCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import { getWidgetDropHandler } from '@/ui-desks/widget-actions/drop-handlers';
import { NOTE_WIDGET_TYPE, type NoteTone } from '@/ui-desks/widgets/note/types';
import type { DeskConfig } from '@/ui-desks/desk/types';
import type { DeskWidget, WidgetDropHandler } from '@/ui-desks/widgets/types';

export interface DeskWidgetConnectionTarget {
	shapeId: TLShapeId;
	widget: DeskWidget;
	label: string;
	title: string;
	pillBg?: string;
}

export interface SelectedDeskConnectorToolbarItem {
	shapeId: TLShapeId;
	sourceLabel: string;
	targetLabel: string;
}

export function getOutgoingWidgetConnections(
	editor: Editor,
	sourceShapeId: TLShapeId
): DeskWidgetConnectionTarget[] {
	const targets: DeskWidgetConnectionTarget[] = [];
	for ( const connectorShape of editor
		.getCurrentPageShapes()
		.filter( isDeskConnectorCanvasShape ) ) {
		const endpoints = getDeskConnectorEndpoints( editor, connectorShape.id );
		if ( ! endpoints || endpoints.sourceShapeId !== sourceShapeId ) {
			continue;
		}

		const targetShape = editor.getShape( endpoints.targetShapeId );
		const widget = targetShape ? canvasShapeToDeskWidget( targetShape ) : null;
		if ( ! widget || ! targetShape ) {
			continue;
		}

		targets.push( {
			shapeId: targetShape.id,
			widget,
			label: getDeskWidgetConnectionLabel( widget ),
			title: getDeskWidgetConnectionTitle( widget ),
			pillBg: getDeskWidgetConnectionPillBg( widget ),
		} );
	}
	return targets;
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
		const widget = sourceShape ? canvasShapeToDeskWidget( sourceShape ) : null;
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

export function getCurrentSelectedWidgetConnectionTargets( editor: Editor ) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length !== 1 ) {
		return [];
	}

	const [ selectedShapeId ] = selectedShapeIds;
	const selectedShape = editor.getShape( selectedShapeId );
	if ( ! selectedShape || ! canvasShapeToDeskWidget( selectedShape ) ) {
		return [];
	}

	return getOutgoingWidgetConnections( editor, selectedShapeId );
}

export function getSelectedDeskConnectorToolbarItem(
	editor: Editor
): SelectedDeskConnectorToolbarItem | null {
	const [ selectedShapeId ] = editor.getSelectedShapeIds();
	if ( ! selectedShapeId || editor.getSelectedShapeIds().length !== 1 ) {
		return null;
	}

	const connectorShape = editor.getShape( selectedShapeId );
	if ( ! isDeskConnectorCanvasShape( connectorShape ) ) {
		return null;
	}

	const endpoints = getDeskConnectorEndpoints( editor, connectorShape.id );
	if ( ! endpoints ) {
		return null;
	}

	const sourceWidget = getWidgetForShapeId( editor, endpoints.sourceShapeId );
	const targetWidget = getWidgetForShapeId( editor, endpoints.targetShapeId );
	if ( ! sourceWidget || ! targetWidget ) {
		return null;
	}

	return {
		shapeId: connectorShape.id,
		sourceLabel: getDeskWidgetConnectionLabel( sourceWidget ),
		targetLabel: getDeskWidgetConnectionLabel( targetWidget ),
	};
}

export function getWidgetShapeAtPagePoint( editor: Editor, point: { x: number; y: number } ) {
	return editor.getShapeAtPoint( point, {
		hitInside: true,
		renderingOnly: true,
		margin: editor.options.hitTestMargin / editor.getZoomLevel(),
	} ) as TLShape | undefined;
}

export function getConnectableShapeAtPagePoint(
	editor: Editor,
	point: { x: number; y: number },
	sourceShapeId: TLShapeId
) {
	const shape = getWidgetShapeAtPagePoint( editor, point );

	if ( ! shape || shape.id === sourceShapeId || isDeskConnectorCanvasShape( shape ) ) {
		return null;
	}

	return canvasShapeToDeskWidget( shape ) ? shape : null;
}

export function getWidgetDropTargetAtPagePoint(
	editor: Editor,
	point: { x: number; y: number },
	sourceShapeId: TLShapeId,
	sourceWidget: DeskWidget
): { shape: TLShape; widget: DeskWidget; handler: WidgetDropHandler } | null {
	const target = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => shape.id !== sourceShapeId && ! isDeskConnectorCanvasShape( shape ) )
		.map( ( shape ) => {
			const bounds = editor.getShapePageBounds( shape.id );
			const widget = canvasShapeToDeskWidget( shape );
			const handler = widget ? getWidgetDropHandler( sourceWidget, widget ) : null;
			return bounds && widget && handler && isPointInBounds( point, bounds )
				? { shape, widget, handler }
				: null;
		} )
		.filter(
			( item ): item is { shape: TLShape; widget: DeskWidget; handler: WidgetDropHandler } =>
				item !== null
		)
		.sort( ( first, second ) => sortByIndex( second.shape, first.shape ) )[ 0 ];

	return target ?? null;
}

export function getDeskConnectorEndpoints(
	editor: Editor,
	connectorShapeId: TLShapeId
): DeskConnectorEndpoints | null {
	const connectorShape = editor.getShape( connectorShapeId );
	if ( ! isDeskConnectorCanvasShape( connectorShape ) ) {
		return null;
	}

	const bindings = editor.getBindingsFromShape( connectorShapeId, 'arrow' );
	const startBinding = bindings.find(
		( binding ) => getArrowBindingTerminal( binding.props ) === 'start'
	);
	const endBinding = bindings.find(
		( binding ) => getArrowBindingTerminal( binding.props ) === 'end'
	);
	if ( ! startBinding || ! endBinding ) {
		return null;
	}

	return {
		sourceShapeId: startBinding.toId,
		targetShapeId: endBinding.toId,
	};
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
		const text = typeof props.text === 'string' ? getRichTextPlainText( props.text ).trim() : '';
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

interface DeskConnectorEndpoints {
	sourceShapeId: TLShapeId;
	targetShapeId: TLShapeId;
}

function getWidgetForShapeId( editor: Editor, shapeId: TLShapeId ) {
	const shape = editor.getShape( shapeId ) as TLShape | undefined;
	return shape ? canvasShapeToDeskWidget( shape ) : null;
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

function getRichTextPlainText( value: string ) {
	if ( typeof document === 'undefined' ) {
		return stripMarkup( value );
	}

	return RichTextData.fromHTMLString( value ).toPlainText();
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

function stripMarkup( value: string ) {
	return value
		.replace( /<[^>]*>/g, ' ' )
		.replace( /\s+/g, ' ' )
		.trim();
}

function isPointInBounds(
	point: { x: number; y: number },
	bounds: { minX: number; minY: number; maxX: number; maxY: number }
) {
	return (
		point.x >= bounds.minX &&
		point.x <= bounds.maxX &&
		point.y >= bounds.minY &&
		point.y <= bounds.maxY
	);
}
