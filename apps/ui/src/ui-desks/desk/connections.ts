import { RichTextData } from '@wordpress/rich-text';
import {
	canvasShapeToDeskWidget,
	isDeskConnectorCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { Editor, TLShape, TLShapeId } from 'tldraw';

export interface DeskWidgetConnectionTarget {
	shapeId: TLShapeId;
	widget: DeskWidget;
	label: string;
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
		} );
	}
	return targets;
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
	switch ( widget.type ) {
		case 'post':
			return typeof props.postId === 'number' ? `Post #${ props.postId }` : 'Post';
		case 'page':
			return typeof props.pageId === 'number' ? `Page #${ props.pageId }` : 'Page';
		case 'note': {
			const text = typeof props.text === 'string' ? getRichTextPlainText( props.text ).trim() : '';
			return text || 'Note';
		}
		case 'site-preview':
			return typeof props.path === 'string' && props.path ? props.path : 'Preview';
		case 'bookmark':
		case 'embed':
			return getUrlHostLabel( props.url ) ?? ( widget.type === 'embed' ? 'Embed' : 'Bookmark' );
		case 'media':
			return typeof props.mediaKind === 'string' && props.mediaKind === 'video' ? 'Video' : 'Image';
		case 'drawing':
			return 'Drawing';
		case 'sd-artefact':
			return 'Artefact';
		case 'blog':
			return 'Blog';
		case 'post-collection':
			return 'Posts';
		default:
			return widget.type;
	}
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
		return value;
	}

	return RichTextData.fromHTMLString( value ).toPlainText();
}
