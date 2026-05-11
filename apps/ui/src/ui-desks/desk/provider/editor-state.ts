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
import { BLOG_WIDGET_TYPE } from '@/ui-desks/widgets/blog/types';
import { createDeskWidget } from '@/ui-desks/widgets/create-widget';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { getSelectedWidgetToolbarItem } from '@/ui-desks/widgets/toolbar-selection';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	canvasShapesToDeskStacks,
	deskConfigToCanvasConnectorBindings,
	deskConfigToCanvasConnectorShapes,
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

interface WidgetToolbarStateOptions {
	canStack?: boolean;
	canUnstack?: boolean;
	canRemove?: boolean;
}

interface HydrateEditorOptions {
	initialViewportMode?: 'site-map';
}

const SITE_MAP_DEFAULT_ZOOM = 0.72;
const SITE_MAP_MIN_ZOOM = 0.4;
const SITE_MAP_MAX_ZOOM = 0.76;
const SITE_MAP_HORIZONTAL_PADDING = 96;
const SITE_MAP_BOTTOM_PADDING = 96;
const SITE_MAP_HOME_TOP = 126;

export function hydrateEditorFromDesk(
	editor: Editor,
	desk: DeskConfig,
	options: HydrateEditorOptions = {}
) {
	const existingShapes = editor.getCurrentPageShapes();
	if ( existingShapes.length > 0 ) {
		editor.run( () => editor.deleteShapes( existingShapes.map( ( shape ) => shape.id ) ), {
			ignoreShapeLock: true,
		} );
	}
	if ( desk.widgets.length > 0 ) {
		const widgetShapes = deskConfigToCanvasShapes( desk );
		editor.createShapes( [
			...deskConfigToCanvasConnectorShapes( desk, widgetShapes ),
			...widgetShapes,
		] );
		editor.createBindings( deskConfigToCanvasConnectorBindings( desk ) );
	}
	if ( desk.viewport ) {
		editor.setCamera( desk.viewport, { immediate: true } );
	} else if ( options.initialViewportMode === 'site-map' && desk.widgets.length > 0 ) {
		setInitialSiteMapCamera( editor );
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

export function getCurrentSelectedWidgetToolbarItem(
	editor: Editor,
	options: WidgetToolbarStateOptions = {}
) {
	return getCurrentSelectedWidgetSelection( editor, options )?.item ?? null;
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

function getCurrentSelectedWidgetSelection(
	editor: Editor,
	options: WidgetToolbarStateOptions = {}
) {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length === 0 ) {
		return null;
	}

	const shapes = selectedShapeIds.map( ( shapeId ) => editor.getShape( shapeId ) );
	if ( shapes.some( ( shape ) => ! shape ) ) {
		return null;
	}

	const derivedSourceSelection = getDerivedSourceWidgetSelection(
		editor,
		shapes as TLShape[],
		options
	);
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
	const item = getSelectedWidgetToolbarItem( widgets as DeskWidget[], {
		stackIds,
		canStack: options.canStack,
		canUnstack: options.canUnstack,
		canRemove: options.canRemove,
	} );
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

function getDerivedSourceWidgetSelection(
	editor: Editor,
	shapes: TLShape[],
	options: WidgetToolbarStateOptions = {}
) {
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
		canStack: options.canStack,
		canUnstack: options.canUnstack,
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

function setInitialSiteMapCamera( editor: Editor ) {
	const homeShape = getSiteMapHomeShape( editor );
	const homeBounds = homeShape ? editor.getShapePageBounds( homeShape.id ) : null;
	if ( ! homeBounds ) {
		ensureContentVisible( editor );
		return;
	}

	const screenBounds = editor.getViewportScreenBounds();
	const zoom = getInitialSiteMapZoom( editor );
	const homeCenterX = ( homeBounds.minX + homeBounds.maxX ) / 2;

	editor.setCamera(
		{
			x: screenBounds.w / 2 / zoom - homeCenterX,
			y: getSiteMapHomeScreenTop( screenBounds.h ) / zoom - homeBounds.minY,
			z: zoom,
		},
		{ immediate: true }
	);
}

function getSiteMapHomeShape( editor: Editor ) {
	const pageShapes = getSiteMapPageShapes( editor );
	return pageShapes
		.map( ( shape ) => ( { shape, bounds: editor.getShapePageBounds( shape.id ) } ) )
		.filter(
			(
				item
			): item is {
				shape: TLShape;
				bounds: NonNullable< ReturnType< Editor[ 'getShapePageBounds' ] > >;
			} => Boolean( item.bounds )
		)
		.sort(
			( first, second ) =>
				first.bounds.minY - second.bounds.minY ||
				first.bounds.minX - second.bounds.minX ||
				sortByIndex( first.shape, second.shape )
		)[ 0 ]?.shape;
}

function getSiteMapPageShapes( editor: Editor ) {
	return getSiteMapWidgetShapes( editor ).filter( ( shape ) => {
		const widget = canvasShapeToDeskWidget( shape );
		return widget?.type === PAGE_WIDGET_TYPE || widget?.type === BLOG_WIDGET_TYPE;
	} );
}

function getSiteMapWidgetShapes( editor: Editor ) {
	return editor
		.getCurrentPageShapes()
		.filter( ( shape ) => canvasShapeToDeskWidget( shape ) !== null );
}

function getInitialSiteMapZoom( editor: Editor ) {
	const bounds = getSiteMapContentBounds( editor );
	if ( ! bounds ) {
		return SITE_MAP_DEFAULT_ZOOM;
	}

	const screenBounds = editor.getViewportScreenBounds();
	const availableWidth = Math.max( 320, screenBounds.w - SITE_MAP_HORIZONTAL_PADDING * 2 );
	const availableHeight = Math.max(
		320,
		screenBounds.h - getSiteMapHomeScreenTop( screenBounds.h ) - SITE_MAP_BOTTOM_PADDING
	);
	const fitZoom = Math.min( availableWidth / bounds.w, availableHeight / bounds.h );

	return clamp( Math.min( SITE_MAP_DEFAULT_ZOOM, fitZoom ), SITE_MAP_MIN_ZOOM, SITE_MAP_MAX_ZOOM );
}

function getSiteMapContentBounds( editor: Editor ) {
	const bounds = getSiteMapWidgetShapes( editor )
		.map( ( shape ) => editor.getShapePageBounds( shape.id ) )
		.filter( ( shapeBounds ): shapeBounds is NonNullable< typeof shapeBounds > =>
			Boolean( shapeBounds )
		);

	if ( bounds.length === 0 ) {
		return null;
	}

	return bounds.reduce(
		( currentBounds, nextBounds ) => ( {
			minX: Math.min( currentBounds.minX, nextBounds.minX ),
			minY: Math.min( currentBounds.minY, nextBounds.minY ),
			maxX: Math.max( currentBounds.maxX, nextBounds.maxX ),
			maxY: Math.max( currentBounds.maxY, nextBounds.maxY ),
			w:
				Math.max( currentBounds.maxX, nextBounds.maxX ) -
				Math.min( currentBounds.minX, nextBounds.minX ),
			h:
				Math.max( currentBounds.maxY, nextBounds.maxY ) -
				Math.min( currentBounds.minY, nextBounds.minY ),
		} ),
		{
			minX: bounds[ 0 ].minX,
			minY: bounds[ 0 ].minY,
			maxX: bounds[ 0 ].maxX,
			maxY: bounds[ 0 ].maxY,
			w: bounds[ 0 ].w,
			h: bounds[ 0 ].h,
		}
	);
}

function getSiteMapHomeScreenTop( screenHeight: number ) {
	return Math.min( SITE_MAP_HOME_TOP, Math.max( 104, screenHeight * 0.18 ) );
}

function clamp( value: number, min: number, max: number ) {
	return Math.min( max, Math.max( min, value ) );
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
