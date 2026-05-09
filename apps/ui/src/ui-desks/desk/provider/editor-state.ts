import { getIndexAbove, sortByIndex, type Editor, type JsonObject, type TLShape } from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	stackSelectedWidgetsInEditor as stackSelectionInEditor,
	unstackSelectedWidgetsInEditor as unstackSelectionInEditor,
} from '@/ui-desks/stacks/editor-commands';
import { getStackId } from '@/ui-desks/stacks/utils';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	canvasShapesToDeskStacks,
	deskConfigToCanvasShapes,
	deskWidgetToCanvasShape,
} from '../tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from '../types';
import type { SelectedWidgetToolbarItem, AddDeskWidgetOptions } from './context';
import type { DeskWidget } from '@/ui-desks/widgets/types';

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
		editor.createShapes( deskConfigToCanvasShapes( desk ) );
	}
	if ( desk.viewport ) {
		editor.setCamera( desk.viewport, { immediate: true } );
	} else if ( desk.widgets.length > 0 ) {
		ensureContentVisible( editor );
	}
	editor.focus();
}

export function createDeskConfigFromEditor( editor: Editor ): DeskConfig {
	const stacks = getCurrentDeskStacks( editor );
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: canvasCameraToDeskViewport( editor.getCamera() ),
		widgets: getCurrentDeskWidgets( editor ),
		...( stacks.length > 0 ? { stacks } : {} ),
	};
}

export function getCurrentSelectedWidgetToolbarItem( editor: Editor ) {
	return getCurrentSelectedWidgetSelection( editor )?.item ?? null;
}

export function addWidgetToEditor(
	editor: Editor,
	type: string,
	creationOffset: number,
	options: AddDeskWidgetOptions = {}
) {
	const viewportCenter = editor.getViewportPageBounds().center;
	const offset = ( creationOffset % 6 ) * 24;
	const widget = createDeskWidget( {
		id: createWidgetId(),
		type,
		center: {
			x: viewportCenter.x + offset,
			y: viewportCenter.y + offset,
		},
		zIndex: getNextZIndexFromShapes( editor.getCurrentPageShapes() ),
		shapeProps: options.shapeProps,
		widgetProps: options.widgetProps,
	} );

	if ( ! widget ) {
		return false;
	}

	const shape = deskWidgetToCanvasShape( widget );
	if ( ! shape.id ) {
		return false;
	}

	editor.createShape( shape ).select( shape.id );
	if ( options.shouldStartEditing ?? true ) {
		editor.setEditingShape( shape.id );
	}
	editor.focus();
	return true;
}

export function updateSelectedWidgetPropsInEditor(
	editor: Editor,
	widgetProps: Record< string, unknown >
): SelectedWidgetToolbarItem | null {
	const selection = getCurrentSelectedWidgetSelection( editor );
	if ( ! selection || selection.item.kind !== 'single-widget' ) {
		return null;
	}

	const { item, shapes } = selection;
	const [ shape ] = shapes;
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

	editor.deleteShapes( selection.shapes.map( ( shape ) => shape.id ) );
	return true;
}

export function stackSelectedWidgetsInEditor( editor: Editor ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	return stackSelectionInEditor(
		editor,
		selection ? { ...selection.item, shapes: selection.shapes } : null
	);
}

export function unstackSelectedWidgetsInEditor( editor: Editor ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	return unstackSelectionInEditor(
		editor,
		selection ? { ...selection.item, shapes: selection.shapes } : null
	);
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
	if ( selectedShapeIds.length === 0 ) {
		return null;
	}

	const shapes = selectedShapeIds.map( ( shapeId ) => editor.getShape( shapeId ) );
	if ( shapes.some( ( shape ) => ! shape ) ) {
		return null;
	}

	const widgets = shapes.map( ( shape ) => canvasShapeToDeskWidget( shape as TLShape ) );
	if ( widgets.some( ( widget ) => ! widget ) ) {
		return null;
	}

	const stackIds = Array.from(
		new Set(
			( shapes as TLShape[] )
				.map( getStackId )
				.filter( ( stackId ): stackId is string => stackId !== null )
		)
	);
	const item = getSelectedWidgetToolbarItem( widgets as DeskWidget[], { stackIds } );
	if ( ! item ) {
		return null;
	}

	return {
		item,
		shapes: shapes as TLShape[],
	};
}

function getCurrentDeskWidgets( editor: Editor ) {
	return editor
		.getCurrentPageShapes()
		.map( canvasShapeToDeskWidget )
		.filter( ( widget ) => widget !== null );
}

function getCurrentDeskStacks( editor: Editor ) {
	return canvasShapesToDeskStacks( editor.getCurrentPageShapes() );
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

function getHighestShapeIndex( shapes: Pick< TLShape, 'index' >[] ) {
	return [ ...shapes ].sort( sortByIndex ).at( -1 )?.index;
}

function getNextZIndexFromShapes( shapes: TLShape[] ) {
	return getIndexAbove( getHighestShapeIndex( shapes ) );
}

function createWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `widget-${ Date.now().toString( 36 ) }`;
}
