import {
	createShapeId,
	getIndexAbove,
	getIndicesAbove,
	sortByIndex,
	type Editor,
	type TLArrowShape,
	type JsonObject,
	type TLDrawShape,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
} from 'tldraw';
import { getSelectedWidgetToolbarItem } from '@/ui-desks/desk/selection-toolbar/selection';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	isRectangleWidgetShapeProps,
	type RectangleWidgetShape,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	setStackViewInEditor,
	stackSelectedWidgetsInEditor as stackSelectionInEditor,
	unstackSelectedWidgetsInEditor as unstackSelectionInEditor,
} from '@/ui-desks/stacks/editor-commands';
import {
	getStackAnchorFromMember,
	getStackConfiguredViewMode,
	getStackHome,
	getStackId,
	getStackOrder,
	getStackViewMode,
	getStackZIndexFromMember,
	type StackViewMode,
} from '@/ui-desks/stacks/utils';
import { createDeskWidget } from '@/ui-desks/widget-actions/create-widget';
import { BLOG_WIDGET_TYPE } from '@/ui-desks/widgets/blog/types';
import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { PAGE_WIDGET_TYPE } from '@/ui-desks/widgets/page/types';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import {
	canvasCameraToDeskViewport,
	canvasShapeToDeskWidget,
	canvasShapesToDeskConnectors,
	canvasShapesToDeskStacks,
	deskConfigToCanvasConnectorBindings,
	deskConfigToCanvasConnectorShapes,
	deskConfigToCanvasShapes,
	deskWidgetToCanvasShape,
	getDerivedDeskCanvasRecordSourceId,
	getTemporaryDeskCanvasRecordId,
	getTemporaryDeskCanvasRecordMeta,
	hasOnlyDeskCanvasRecordResolutionStateChange,
	isDerivedDeskCanvasRecord,
	isPersistentDeskCanvasShape,
	CONNECTOR_SHAPE_ID_PREFIX,
} from '../../tldraw-adapter';
import { DESK_CONFIG_VERSION, type DeskConfig } from '../../types';
import type {
	SelectedWidgetToolbarItem,
	AddDeskWidgetOptions,
	DeskMaterialization,
	TemporaryDeskConnector,
	ToggleTemporaryDeskOptions,
} from '../context';
import type { DeskWidget } from '@/ui-desks/widgets/types';

type RectangleWidgetFitContentHandler = ( context: {
	widgetProps: Record< string, unknown >;
	shapeProps: RectangleWidgetShape[ 'props' ][ 'shapeProps' ];
} ) => Record< string, unknown > | null | Promise< Record< string, unknown > | null >;

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
	canSetStackView?: boolean;
	canRemove?: boolean;
}

interface CurrentSelectedWidgetSelection {
	item: SelectedWidgetToolbarItem;
	shapes: TLShape[];
	removalShapes?: TLShape[];
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
const DRAWING_WIDGET_PADDING = 16;

export function hydrateEditorFromDesk(
	editor: Editor,
	desk: DeskConfig,
	options: HydrateEditorOptions = {}
) {
	const widgetShapes = desk.widgets.length > 0 ? deskConfigToCanvasShapes( desk ) : [];
	const connectorShapes =
		desk.widgets.length > 0 ? deskConfigToCanvasConnectorShapes( desk, widgetShapes ) : [];
	const connectorBindings =
		desk.widgets.length > 0 ? deskConfigToCanvasConnectorBindings( desk ) : [];
	const existingShapes = editor.getCurrentPageShapes();
	if ( existingShapes.length > 0 ) {
		editor.run( () => editor.deleteShapes( existingShapes.map( ( shape ) => shape.id ) ), {
			ignoreShapeLock: true,
		} );
	}
	if ( widgetShapes.length > 0 ) {
		editor.createShapes( [ ...connectorShapes, ...widgetShapes ] );
		editor.createBindings( connectorBindings );
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
	const connectors = getCurrentDeskConnectors( editor );
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: canvasCameraToDeskViewport( editor.getCamera() ),
		widgets: getCurrentDeskWidgets( editor ),
		...( stacks.length > 0 ? { stacks } : {} ),
		...( connectors.length > 0 ? { connectors } : {} ),
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

export function addMaterializedDeskToEditor(
	editor: Editor,
	materialization: DeskMaterialization
) {
	if ( materialization.widgets.length === 0 ) {
		return false;
	}

	const config = {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		widgets: materialization.widgets,
		...( materialization.stacks?.length ? { stacks: materialization.stacks } : {} ),
		...( materialization.connectors?.length ? { connectors: materialization.connectors } : {} ),
	} satisfies DeskConfig;
	const widgetShapes = deskConfigToCanvasShapes( config );
	const renderIndices = getIndicesAbove(
		getHighestShapeIndex( editor.getCurrentPageShapes() ),
		widgetShapes.length
	);
	const indexedWidgetShapes = widgetShapes.map( ( shape, index ) => ( {
		...shape,
		index: renderIndices[ index ],
	} ) );
	const connectorShapes = deskConfigToCanvasConnectorShapes( config, indexedWidgetShapes );
	const connectorBindings = deskConfigToCanvasConnectorBindings( config );

	editor.createShapes( [ ...connectorShapes, ...indexedWidgetShapes ] );
	if ( connectorBindings.length > 0 ) {
		editor.createBindings( connectorBindings );
	}

	const selectedShapeIds = (
		materialization.selectWidgetIds ?? materialization.widgets.map( ( widget ) => widget.id )
	)
		.map( ( widgetId ) => createShapeId( widgetId ) )
		.filter( ( shapeId ) => editor.getShape( shapeId ) );
	if ( selectedShapeIds.length > 0 ) {
		editor.setSelectedShapes( selectedShapeIds );
	}
	editor.focus();
	return true;
}

export async function convertDrawShapesToDrawingWidget(
	editor: Editor,
	drawShapes: TLDrawShape[]
) {
	if ( drawShapes.length === 0 ) {
		return false;
	}

	const drawShapeIds = drawShapes.map( ( shape ) => shape.id );
	const bounds = getCombinedShapePageBounds( editor, drawShapeIds );
	if ( ! bounds ) {
		return false;
	}

	const svg = await editor.getSvgString( drawShapeIds, {
		background: false,
		padding: DRAWING_WIDGET_PADDING,
		preserveAspectRatio: 'xMidYMid meet',
	} );
	if ( ! svg ) {
		return false;
	}

	editor.deleteShapes( drawShapeIds );

	return addWidgetToEditor( editor, DRAWING_WIDGET_TYPE, 0, {
		center: {
			x: bounds.minX + bounds.w / 2,
			y: bounds.minY + bounds.h / 2,
		},
		shapeProps: {
			w: Math.max( 1, svg.width ),
			h: Math.max( 1, svg.height ),
		},
		widgetProps: {
			svg: svg.svg,
		},
		shouldStartEditing: false,
	} );
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

export async function fitSelectedWidgetToContentInEditor( editor: Editor ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	if ( ! selection || selection.item.kind !== 'single-widget' ) {
		return false;
	}

	const { item, shapes } = selection;
	const [ shape ] = shapes;
	const getFittedShapeProps = item.definition.getFittedShapeProps as
		| RectangleWidgetFitContentHandler
		| undefined;
	if ( ! getFittedShapeProps || ! isRectangleWidgetShape( shape ) ) {
		return false;
	}

	const nextShapeProps = await getFittedShapeProps( {
		widgetProps: item.widget.widgetProps,
		shapeProps: shape.props.shapeProps,
	} );
	if ( editor.isDisposed || ! nextShapeProps || ! isRectangleWidgetShapeProps( nextShapeProps ) ) {
		return false;
	}

	const centerX = shape.x + shape.props.shapeProps.w / 2;
	const centerY = shape.y + shape.props.shapeProps.h / 2;
	editor.updateShape< RectangleWidgetShape >( {
		id: shape.id,
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: centerX - nextShapeProps.w / 2,
		y: centerY - nextShapeProps.h / 2,
		props: {
			shapeProps: {
				...shape.props.shapeProps,
				...nextShapeProps,
			},
		},
	} );

	return true;
}

export function removeSelectedWidgetFromEditor( editor: Editor ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	if ( ! selection || ! selection.item.canRemove ) {
		return false;
	}

	const shapesToRemove = selection.removalShapes ?? selection.shapes;
	editor.deleteShapes( shapesToRemove.map( ( shape ) => shape.id ) );
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

export function setSelectedStackViewInEditor( editor: Editor, viewMode: StackViewMode ) {
	const selection = getCurrentSelectedWidgetSelection( editor );
	const stackId =
		selection?.item.canSetStackView && selection.item.stackIds.length === 1
			? selection.item.stackIds[ 0 ]
			: null;

	if ( ! stackId ) {
		return false;
	}

	return setStackViewInEditor( editor, stackId, viewMode );
}

export function isTemporaryDeskVisibleInEditor( editor: Editor, id: string ) {
	return editor
		.getCurrentPageShapes()
		.some( ( shape ) => getTemporaryDeskCanvasRecordId( shape ) === id );
}

export function toggleTemporaryDeskInEditor( editor: Editor, options: ToggleTemporaryDeskOptions ) {
	const existingShapeIds = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getTemporaryDeskCanvasRecordId( shape ) === options.id )
		.map( ( shape ) => shape.id );
	if ( existingShapeIds.length > 0 ) {
		editor.deleteShapes( existingShapeIds );
		return true;
	}

	if ( options.widgets.length === 0 && ! options.connectors?.length ) {
		return false;
	}

	const desk: DeskConfig = {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		widgets: options.widgets,
		...( options.stacks?.length ? { stacks: options.stacks } : {} ),
		...( options.connectors?.length
			? { connectors: options.connectors.map( deskConnectorFromTemporaryConnector ) }
			: {} ),
	};
	const widgetShapes = deskConfigToCanvasShapes( desk ).map( ( shape ) =>
		markTemporaryDeskShape( shape, options )
	);
	const connectorShapes = deskConfigToCanvasConnectorShapes( desk, widgetShapes ).map( ( shape ) =>
		markTemporaryDeskConnectorShape( shape, options )
	);
	const bindings = deskConfigToCanvasConnectorBindings( desk );

	editor.createShapes( [ ...connectorShapes, ...widgetShapes ] );
	if ( bindings.length > 0 ) {
		editor.createBindings( bindings );
	}
	editor.focus();
	return true;
}

function deskConnectorFromTemporaryConnector( connector: TemporaryDeskConnector ) {
	const { appearance: _appearance, ...deskConnector } = connector;
	return deskConnector;
}

function markTemporaryDeskShape< TShape extends TLShapePartial >(
	shape: TShape,
	options: ToggleTemporaryDeskOptions
): TShape {
	const followSourceWidgetId =
		options.followSource && options.sourceWidgetId ? options.sourceWidgetId : undefined;
	return {
		...shape,
		meta: {
			...( getTemporaryDeskCanvasRecordMeta( shape ) ?? {} ),
			studioDeskTemporaryId: options.id,
			...( followSourceWidgetId && shape.type !== 'arrow'
				? { studioDeskFollowSourceWidgetId: followSourceWidgetId }
				: {} ),
		},
	};
}

function markTemporaryDeskConnectorShape(
	shape: TLShapePartial< TLArrowShape >,
	options: ToggleTemporaryDeskOptions
): TLShapePartial< TLArrowShape > {
	const connectorId = getTemporaryDeskConnectorIdFromShape( shape );
	const connector = options.connectors?.find( ( candidate ) => candidate.id === connectorId );
	return {
		...markTemporaryDeskShape( shape, options ),
		props: connector?.appearance
			? {
					...shape.props,
					...connector.appearance,
			  }
			: shape.props,
	};
}

function getTemporaryDeskConnectorIdFromShape( shape: TLShapePartial< TLArrowShape > ) {
	const shapeId = String( shape.id ?? '' );
	const recordId = shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
	return recordId.startsWith( CONNECTOR_SHAPE_ID_PREFIX )
		? recordId.slice( CONNECTOR_SHAPE_ID_PREFIX.length )
		: recordId;
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
): CurrentSelectedWidgetSelection | null {
	const selectedShapeIds = editor.getSelectedShapeIds();
	if ( selectedShapeIds.length === 0 ) {
		return null;
	}

	const shapes = selectedShapeIds.map( ( shapeId ) => editor.getShape( shapeId ) );
	if ( shapes.some( ( shape ) => ! shape ) ) {
		return null;
	}

	const typedShapes = shapes as TLShape[];
	const derivedSourceSelection = getDerivedSourceWidgetSelection( editor, typedShapes, options );
	if ( derivedSourceSelection ) {
		return derivedSourceSelection;
	}

	const widgets = typedShapes.map( ( shape ) => canvasShapeToDeskWidget( shape ) );
	if ( widgets.some( ( widget ) => ! widget ) ) {
		return null;
	}
	const hasDerivedShapes = typedShapes.some( isDerivedDeskCanvasRecord );

	const stackIds = Array.from(
		new Set(
			typedShapes.map( getStackId ).filter( ( stackId ): stackId is string => stackId !== null )
		)
	);
	const selectedStackState = getSelectedStackState( editor, typedShapes );
	const item = getSelectedWidgetToolbarItem( widgets as DeskWidget[], {
		stackIds,
		stackViewMode: selectedStackState?.viewMode,
		canStack: ( options.canStack ?? true ) && ! hasDerivedShapes,
		canUnstack: ( options.canUnstack ?? true ) && ! hasDerivedShapes,
		canSetStackView: options.canSetStackView,
		canRemove: hasDerivedShapes ? false : options.canRemove,
	} );
	if ( ! item ) {
		return null;
	}

	return {
		item,
		shapes: shapes as TLShape[],
	};
}

function isRectangleWidgetShape( shape: unknown ): shape is RectangleWidgetShape {
	return (
		Boolean( shape ) &&
		typeof shape === 'object' &&
		( shape as { type?: unknown } ).type === RECTANGLE_WIDGET_SHAPE_TYPE
	);
}

function getSelectedStackState( editor: Editor, shapes: TLShape[] ) {
	let stackId: string | null = null;

	for ( const shape of shapes ) {
		const nextStackId = getStackId( shape );
		if ( ! nextStackId ) {
			return null;
		}

		if ( stackId === null ) {
			stackId = nextStackId;
		} else if ( stackId !== nextStackId ) {
			return null;
		}
	}

	const firstShape = shapes[ 0 ];
	if ( ! stackId || ! firstShape ) {
		return null;
	}

	const selectedShapeIds = new Set( shapes.map( ( shape ) => shape.id ) );
	const stackMemberIds = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getStackId( shape ) === stackId )
		.map( ( shape ) => shape.id );
	if (
		stackMemberIds.length < 2 ||
		stackMemberIds.some( ( shapeId ) => ! selectedShapeIds.has( shapeId ) )
	) {
		return null;
	}

	return {
		id: stackId,
		viewMode: getStackConfiguredViewMode( firstShape ),
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

function getCurrentDeskConnectors( editor: Editor ) {
	return canvasShapesToDeskConnectors( editor.getCurrentPageShapes(), ( shapeId ) =>
		editor.getBindingsFromShape( shapeId, 'arrow' )
	);
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

	if (
		getTemporaryDeskCanvasRecordId( previousRecord ) ||
		getTemporaryDeskCanvasRecordId( nextRecord )
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
		deskStackViewMode: meta.deskStackViewMode,
		deskStackOpenViewMode: meta.deskStackOpenViewMode,
	} );
}

function getDerivedSourceWidgetSelection(
	editor: Editor,
	shapes: TLShape[],
	options: WidgetToolbarStateOptions = {}
): CurrentSelectedWidgetSelection | null {
	if ( ! isCompleteDerivedStackSelection( editor, shapes ) ) {
		return null;
	}

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
		canRemove: options.canRemove,
	} );
	if ( ! item ) {
		return null;
	}

	return {
		item,
		shapes: [ sourceShape ],
		removalShapes: shapes,
	};
}

function isCompleteDerivedStackSelection( editor: Editor, shapes: TLShape[] ) {
	if ( shapes.length < 2 || shapes.some( ( shape ) => ! isDerivedDeskCanvasRecord( shape ) ) ) {
		return false;
	}

	let stackId: string | null = null;
	for ( const shape of shapes ) {
		const nextStackId = getStackId( shape );
		if ( ! nextStackId ) {
			return false;
		}

		if ( stackId === null ) {
			stackId = nextStackId;
		} else if ( stackId !== nextStackId ) {
			return false;
		}
	}

	const selectedShapeIds = new Set( shapes.map( ( shape ) => shape.id ) );
	const stackMemberIds = editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getStackId( shape ) === stackId )
		.map( ( shape ) => shape.id );

	return (
		stackMemberIds.length === selectedShapeIds.size &&
		stackMemberIds.every( ( shapeId ) => selectedShapeIds.has( shapeId ) )
	);
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
	const sourceWidgetsById = new Map(
		shapes
			.filter( isPersistentDeskCanvasShape )
			.map( canvasShapeToDeskWidget )
			.filter( ( widget ): widget is DeskWidget => widget !== null )
			.map( ( widget ) => [ widget.id, widget ] )
	);

	for ( const shape of shapes ) {
		const sourceWidgetId = getDerivedDeskCanvasRecordSourceId( shape );
		if ( ! sourceWidgetId ) {
			continue;
		}
		const sourceWidget = sourceWidgetsById.get( sourceWidgetId );
		if ( sourceWidget && getWidgetDefinition( sourceWidget.type )?.preserveSourceWidgetPosition ) {
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

	if ( getStackViewMode( firstShape ) === 'tiles' ) {
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
		...getStackAnchorFromMember( firstShape, order, shapes.length ),
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

export function isDrawShape( shape: TLShape ): shape is TLDrawShape {
	return shape.type === 'draw';
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

function getCombinedShapePageBounds( editor: Editor, shapeIds: TLShapeId[] ) {
	const bounds = shapeIds
		.map( ( shapeId ) => editor.getShapePageBounds( shapeId ) )
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
