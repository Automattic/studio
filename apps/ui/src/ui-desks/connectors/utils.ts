import { sortByIndex, type Editor, type TLShape, type TLShapeId } from 'tldraw';
import {
	getDeskWidgetConnectionLabel,
	getDeskWidgetConnectionPillBg,
	getDeskWidgetConnectionTitle,
	type DeskWidgetConnectionTarget,
} from '@/ui-desks/connectors/context';
import {
	canvasShapeToDeskWidget,
	isDeskConnectorCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import { getWidgetDropHandler } from '@/ui-desks/widget-actions/drop-handlers';
import type { DeskWidget, WidgetDropHandler } from '@/ui-desks/widgets/types';

export type { DeskWidgetConnectionTarget };

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

export function isShapePartOfMultiSelection(
	editor: Pick< Editor, 'getSelectedShapeIds' >,
	shapeId: TLShapeId
) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	return selectedShapeIds.length > 1 && selectedShapeIds.includes( shapeId );
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
