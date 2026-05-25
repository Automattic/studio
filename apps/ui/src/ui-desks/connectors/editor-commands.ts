import { createShapeId, type Editor, type TLArrowShape, type TLShapeId } from 'tldraw';
import {
	CONNECTOR_COLOR,
	CONNECTOR_DASH,
	CONNECTOR_DEFAULT_BEND,
	CONNECTOR_SHAPE_ID_PREFIX,
	canvasShapeToDeskWidget,
} from '@/ui-desks/desk/tldraw-adapter';
import { focusOnDeskShape, getSelectedDeskConnectorToolbarItem } from './utils';

export function createConnectorPreview(
	editor: Editor,
	sourceShapeId: TLShapeId,
	startPoint: { x: number; y: number },
	endPoint: { x: number; y: number }
) {
	const arrowId = createShapeId(
		`${ CONNECTOR_SHAPE_ID_PREFIX }${ createConnectorId() }`
	) as TLArrowShape[ 'id' ];
	editor.createShape< TLArrowShape >( {
		id: arrowId,
		type: 'arrow',
		meta: {
			studioDeskConnector: true,
		},
		props: {
			kind: 'arc',
			color: CONNECTOR_COLOR,
			dash: CONNECTOR_DASH,
			size: 'm',
			bend: CONNECTOR_DEFAULT_BEND,
			arrowheadStart: 'dot',
			arrowheadEnd: 'arrow',
			start: startPoint,
			end: endPoint,
		},
	} );
	editor.createBindings( [
		{
			type: 'arrow',
			fromId: arrowId,
			toId: sourceShapeId,
			props: {
				terminal: 'start' as const,
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
				snap: 'none' as const,
			},
		},
	] );
	return arrowId;
}

export function completeConnectorPreview(
	editor: Editor,
	connectorShapeId: TLArrowShape[ 'id' ],
	targetShapeId: TLShapeId
) {
	editor.createBindings( [
		{
			type: 'arrow',
			fromId: connectorShapeId,
			toId: targetShapeId,
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

export function updateConnectorEnd(
	editor: Editor,
	connectorShapeId: TLArrowShape[ 'id' ],
	endPoint: { x: number; y: number }
) {
	editor.updateShape< TLArrowShape >( {
		id: connectorShapeId,
		type: 'arrow',
		props: {
			end: endPoint,
		},
	} );
}

export function removeSelectedConnectorFromEditor( editor: Editor ) {
	const connector = getSelectedDeskConnectorToolbarItem( editor );
	if ( ! connector ) {
		return false;
	}

	editor.deleteShape( connector.shapeId );
	return true;
}

export function startConnectingWidgetInEditor( editor: Editor, shapeId: TLShapeId ) {
	const shape = editor.getShape( shapeId );
	if ( ! shape || ! canvasShapeToDeskWidget( shape ) ) {
		return false;
	}

	editor.focus();
	return true;
}

export function focusConnectedWidgetInEditor( editor: Editor, shapeId: TLShapeId ) {
	return focusOnDeskShape( editor, shapeId );
}

export function toPlainPoint( point: { x: number; y: number } ) {
	return {
		x: point.x,
		y: point.y,
	};
}

export function getInitialConnectorEndPoint(
	startPoint: { x: number; y: number },
	cursorPoint: { x: number; y: number }
) {
	const distance = Math.hypot( cursorPoint.x - startPoint.x, cursorPoint.y - startPoint.y );
	if ( distance >= 8 ) {
		return cursorPoint;
	}

	return {
		x: startPoint.x + 96,
		y: startPoint.y,
	};
}

function createConnectorId() {
	return globalThis.crypto?.randomUUID?.() ?? `connector-${ Date.now().toString( 36 ) }`;
}
