import { getIndexAbove, sortByIndex, type Editor, type JsonObject, type TLShape } from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	stackSelectedWidgetsInEditor as stackSelectionInEditor,
	unstackSelectedWidgetsInEditor as unstackSelectionInEditor,
} from '@/ui-desks/stacks/editor-commands';
import {
	getStackAnchorFromMember,
	getStackHome,
	getStackId,
	getStackOrder,
	getStackZIndexFromMember,
} from '@/ui-desks/stacks/utils';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	canvasShapesToDeskStacks,
	deskConfigToCanvasShapes,
	deskWidgetToCanvasShape,
	getDerivedDeskCanvasRecordSourceId,
	hasOnlyDeskCanvasRecordResolutionStateChange,
	isDerivedDeskCanvasRecord,
	isPersistentDeskCanvasShape,
} from '../tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from '../types';
import type { SelectedWidgetToolbarItem, AddDeskWidgetOptions } from './context';
import type { DeskWidget } from '@/ui-desks/widgets/types';

interface CanvasStoreChanges {
	added: Record< string, unknown >;
	updated: Record< string, readonly [ unknown, unknown ] >;
	removed: Record< string, unknown >;
}

interface DerivedWidgetAnchor {
	x: number;
	y: number;
	zIndex?: string;
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
	const center = options.center ?? {
		x: viewportCenter.x + offset,
		y: viewportCenter.y + offset,
	};
	const widget = createDeskWidget( {
		id: options.id ?? createWidgetId(),
		type,
		center,
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
	if ( ! selection || ! selection.item.canRemove ) {
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

export function hasPersistentDocumentChange( changes: CanvasStoreChanges ) {
	const addedOrRemovedRecords = [
		...Object.values( changes.added ),
		...Object.values( changes.removed ),
	];
	if ( addedOrRemovedRecords.some( isPersistentDocumentRecord ) ) {
		return true;
	}

	return Object.values( changes.updated ).some( ( [ previousRecord, nextRecord ] ) => {
		if ( isShapeRecord( previousRecord ) || isShapeRecord( nextRecord ) ) {
			if ( hasOnlyDeskCanvasRecordResolutionStateChange( previousRecord, nextRecord ) ) {
				return false;
			}

			if (
				isDerivedDeskCanvasRecord( previousRecord ) ||
				isDerivedDeskCanvasRecord( nextRecord )
			) {
				return hasDerivedShapePersistenceChange( previousRecord, nextRecord );
			}

			return (
				isPersistentDocumentRecord( previousRecord ) || isPersistentDocumentRecord( nextRecord )
			);
		}

		return true;
	} );
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

	const derivedSourceSelection = getDerivedSourceWidgetSelection( editor, shapes as TLShape[] );
	if ( derivedSourceSelection ) {
		return derivedSourceSelection;
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

export function getCurrentDeskWidgets( editor: Editor ) {
	const shapes = editor.getCurrentPageShapes();
	const derivedAnchors = getDerivedWidgetAnchorsBySourceId( shapes );

	return shapes
		.filter( isPersistentDeskCanvasShape )
		.map( canvasShapeToDeskWidget )
		.filter( ( widget ): widget is DeskWidget => widget !== null )
		.map( ( widget ) => {
			const anchor = derivedAnchors.get( widget.id );
			return anchor ? { ...widget, ...anchor } : widget;
		} );
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

function isShapeRecord( value: unknown ) {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( value as { typeName?: unknown } ).typeName === 'shape'
	);
}

function isPersistentDocumentRecord( value: unknown ) {
	if ( isShapeRecord( value ) ) {
		return ! isDerivedDeskCanvasRecord( value );
	}

	return true;
}

function hasDerivedShapePersistenceChange( previousRecord: unknown, nextRecord: unknown ) {
	if (
		! isDerivedDeskCanvasRecord( previousRecord ) ||
		! isDerivedDeskCanvasRecord( nextRecord )
	) {
		return false;
	}

	return (
		getDerivedShapePersistenceSignature( previousRecord ) !==
		getDerivedShapePersistenceSignature( nextRecord )
	);
}

function getDerivedShapePersistenceSignature( value: unknown ) {
	const shape = value as Partial< TLShape >;
	const meta = ( shape.meta ?? {} ) as Record< string, unknown >;

	return JSON.stringify( {
		x: shape.x,
		y: shape.y,
		rotation: shape.rotation,
		index: shape.index,
		deskStackExpanded: meta.deskStackExpanded,
		deskStackHomeX: meta.deskStackHomeX,
		deskStackHomeY: meta.deskStackHomeY,
		deskStackHomeZIndex: meta.deskStackHomeZIndex,
	} );
}

function getDerivedSourceWidgetSelection( editor: Editor, shapes: TLShape[] ) {
	const sourceWidgetId = getDerivedSelectionSourceWidgetId( shapes );
	if ( ! sourceWidgetId ) {
		return null;
	}

	const sourceShape = editor
		.getCurrentPageShapes()
		.find( ( shape ) => canvasShapeToDeskWidget( shape )?.id === sourceWidgetId );
	if ( ! sourceShape ) {
		return null;
	}

	const sourceWidget = canvasShapeToDeskWidget( sourceShape );
	if ( ! sourceWidget ) {
		return null;
	}

	const item = getSelectedWidgetToolbarItem( [ sourceWidget ], {
		stackIds: [],
		canRemove: false,
	} );
	if ( ! item ) {
		return null;
	}

	return {
		item,
		shapes: [ sourceShape ],
	};
}

function getDerivedSelectionSourceWidgetId( shapes: TLShape[] ) {
	let sourceWidgetId: string | null = null;
	for ( const shape of shapes ) {
		const nextSourceWidgetId = getDerivedDeskCanvasRecordSourceId( shape );
		if ( ! nextSourceWidgetId ) {
			return null;
		}

		if ( sourceWidgetId === null ) {
			sourceWidgetId = nextSourceWidgetId;
		} else if ( sourceWidgetId !== nextSourceWidgetId ) {
			return null;
		}
	}

	return sourceWidgetId;
}

function getDerivedWidgetAnchorsBySourceId( shapes: TLShape[] ) {
	const shapesBySourceId = new Map< string, TLShape[] >();
	for ( const shape of shapes ) {
		const sourceWidgetId = getDerivedDeskCanvasRecordSourceId( shape );
		if ( ! sourceWidgetId ) {
			continue;
		}

		shapesBySourceId.set( sourceWidgetId, [
			...( shapesBySourceId.get( sourceWidgetId ) ?? [] ),
			shape,
		] );
	}

	return new Map(
		Array.from( shapesBySourceId, ( [ sourceWidgetId, sourceShapes ] ) => [
			sourceWidgetId,
			getDerivedWidgetAnchor( sourceShapes ),
		] ).filter( ( entry ): entry is [ string, DerivedWidgetAnchor ] => entry[ 1 ] !== null )
	);
}

function getDerivedWidgetAnchor( shapes: TLShape[] ): DerivedWidgetAnchor | null {
	const firstShape = [ ...shapes ].sort( ( first, second ) => {
		const firstStackOrder = getStackOrder( first );
		const secondStackOrder = getStackOrder( second );
		return firstStackOrder - secondStackOrder || sortByIndex( second, first );
	} )[ 0 ];
	if ( ! firstShape ) {
		return null;
	}

	const stackId = getStackId( firstShape );
	if ( ! stackId ) {
		return {
			x: firstShape.x,
			y: firstShape.y,
			zIndex: firstShape.index,
		};
	}

	const order = getStackOrder( firstShape );
	const home = getStackHome( firstShape );
	if ( home ) {
		return home;
	}

	return {
		...getStackAnchorFromMember( firstShape, order ),
		zIndex: getStackZIndexFromMember( firstShape.index, order ),
	};
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

export function createWidgetId() {
	return globalThis.crypto?.randomUUID?.() ?? `widget-${ Date.now().toString( 36 ) }`;
}
