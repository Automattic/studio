import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	deskWidgetToCanvasShape,
} from '../tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from '../types';
import type { SelectedWidgetToolbarItem } from './context';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { Editor, JsonObject, TLShape } from 'tldraw';

interface CanvasStoreChanges {
	added: Record< string, unknown >;
	updated: Record< string, readonly [ unknown, unknown ] >;
	removed: Record< string, unknown >;
}

export function hydrateEditorFromDesk( editor: Editor, desk: DeskConfig ) {
	const existingShapes = editor.getCurrentPageShapes();
	if ( existingShapes.length > 0 ) {
		editor.deleteShapes( existingShapes.map( ( shape ) => shape.id ) );
	}
	if ( desk.widgets.length > 0 ) {
		editor.createShapes( desk.widgets.map( deskWidgetToCanvasShape ) );
	}
	if ( desk.viewport ) {
		editor.setCamera( desk.viewport, { immediate: true } );
	} else if ( desk.widgets.length > 0 ) {
		ensureContentVisible( editor );
	}
	editor.focus();
}

export function createDeskConfigFromEditor( editor: Editor ): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: canvasCameraToDeskViewport( editor.getCamera() ),
		widgets: getCurrentDeskWidgets( editor ),
	};
}

export function getCurrentSelectedWidgetToolbarItem( editor: Editor ) {
	return getCurrentSelectedWidgetSelection( editor )?.item ?? null;
}

export function addWidgetToEditor( editor: Editor, type: string, creationOffset: number ) {
	const viewportCenter = editor.getViewportPageBounds().center;
	const offset = ( creationOffset % 6 ) * 24;
	const widget = createDeskWidget( {
		id: createWidgetId(),
		type,
		center: {
			x: viewportCenter.x + offset,
			y: viewportCenter.y + offset,
		},
		zIndex: getNextZIndex( getCurrentDeskWidgets( editor ) ),
	} );

	if ( ! widget ) {
		return false;
	}

	const shape = deskWidgetToCanvasShape( widget );
	if ( ! shape.id ) {
		return false;
	}

	editor.createShape( shape ).select( shape.id );
	editor.setEditingShape( shape.id );
	editor.focus();
	return true;
}

export function updateSelectedWidgetPropsInEditor(
	editor: Editor,
	widgetProps: Record< string, unknown >
): SelectedWidgetToolbarItem | null {
	const selection = getCurrentSelectedWidgetSelection( editor );
	if ( ! selection ) {
		return null;
	}

	const { item, shape } = selection;
	const nextWidgetProps = {
		...item.widget.widgetProps,
		...widgetProps,
	};
	if ( ! item.definition.isWidgetProps( nextWidgetProps ) ) {
		return null;
	}

	editor.updateShape< RectangleWidgetShape >( {
		id: shape.id as RectangleWidgetShape[ 'id' ],
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		props: {
			widgetProps: nextWidgetProps as JsonObject,
		},
	} );

	return {
		...item,
		widget: {
			...item.widget,
			widgetProps: nextWidgetProps,
		} as DeskWidget,
	};
}

export function removeSelectedWidgetFromEditor( editor: Editor ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	if ( ! selection ) {
		return false;
	}

	editor.deleteShapes( [ selection.shape.id ] );
	return true;
}

export function hasCameraChange( changes: CanvasStoreChanges ) {
	const updatedRecords = Object.values( changes.updated ).map( ( [ , nextRecord ] ) => nextRecord );
	const records = [
		...Object.values( changes.added ),
		...updatedRecords,
		...Object.values( changes.removed ),
	];
	return records.some( isCameraRecord );
}

function getCurrentSelectedWidgetSelection( editor: Editor ) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length !== 1 ) {
		return null;
	}

	const shape = editor.getShape( selectedShapeIds[ 0 ] );
	if ( ! shape ) {
		return null;
	}

	const widget = canvasShapeToDeskWidget( shape );
	if ( ! widget ) {
		return null;
	}

	const item = getSelectedWidgetToolbarItem( [ widget ] );
	if ( ! item ) {
		return null;
	}

	return {
		item,
		shape: shape as TLShape,
	};
}

function getCurrentDeskWidgets( editor: Editor ) {
	return editor
		.getCurrentPageShapes()
		.map( canvasShapeToDeskWidget )
		.filter( ( widget ) => widget !== null );
}

function isCameraRecord( value: unknown ) {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( value as { typeName?: unknown } ).typeName === 'camera'
	);
}

function ensureContentVisible( editor: Editor ) {
	const shapes = editor.getCurrentPageShapes();
	if ( shapes.length === 0 ) {
		return;
	}

	const viewport = editor.getViewportPageBounds();
	const hasVisibleShape = shapes.some( ( shape ) => {
		const bounds = editor.getShapePageBounds( shape.id );
		return bounds ? viewport.collides( bounds ) : false;
	} );

	if ( ! hasVisibleShape ) {
		editor.zoomToFit( { animation: { duration: 0 } } );
	}
}

function getNextZIndex( widgets: DeskWidget[] ) {
	const nextIndex =
		widgets.reduce( ( max, widget ) => {
			const numericIndex = Number( widget.zIndex.replace( /^a/, '' ) );
			return Number.isFinite( numericIndex ) ? Math.max( max, numericIndex ) : max;
		}, 0 ) + 1;

	return `a${ nextIndex }`;
}

function createWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `widget-${ Date.now().toString( 36 ) }`;
}
