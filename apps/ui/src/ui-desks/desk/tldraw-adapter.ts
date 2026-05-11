import {
	createShapeId,
	getIndicesAbove,
	getIndicesBelow,
	sortByIndex,
	type TLCamera,
	type TLArrowBinding,
	type TLArrowShape,
	type TLBindingCreate,
	type TLShape,
	type TLShapePartial,
} from 'tldraw';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetCanvasProps,
} from '@/ui-desks/shapes/rectangle-widget/types';
import {
	createStackMeta,
	getStackAnchorFromMember,
	getStackHome,
	getStackId,
	getStackMemberLayout,
	getStackMemberZIndex,
	getStackOriginalZIndex,
	getStackPushOrigin,
	getStackOrder,
	getStackZIndexFromMember,
} from '@/ui-desks/stacks/utils';
import { isRectangleWidgetShapeProps } from '@/ui-desks/widgets/geometry';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import type { DeskConfig, DeskStack, DeskViewport } from '@/ui-desks/desk/types';
import type {
	DeskWidget,
	ResolvedDeskWidget,
	WidgetResolutionState,
} from '@/ui-desks/widgets/types';

const SHAPE_ID_PREFIX = 'shape:';
const CONNECTOR_SHAPE_ID_PREFIX = 'connector:';
const DERIVED_WIDGET_ORIGIN = 'derived';
const DERIVED_WIDGET_PERSIST = false;
const CONNECTOR_COLOR = 'grey';

interface DeskCanvasMeta {
	studioDeskOrigin?: typeof DERIVED_WIDGET_ORIGIN;
	studioDeskPersist?: typeof DERIVED_WIDGET_PERSIST;
	studioDeskSourceWidgetId?: string;
	studioDeskDerivedKey?: string;
	studioDeskResolutionState?: WidgetResolutionState;
	studioDeskConnector?: boolean;
}

interface DeskStackMember {
	stack: DeskStack;
	order: number;
}

export function deskConfigToCanvasShapes( desk: DeskConfig ): TLShapePartial[] {
	const stackMembers = getStackMembersByWidgetId( desk.stacks );
	const topLevelItems = getTopLevelDeskItems( desk );
	const renderIndices = getIndicesAbove(
		null,
		topLevelItems.reduce(
			( total, item ) => total + ( item.kind === 'stack' ? item.widgets.length : 1 ),
			0
		)
	);
	const shapes: TLShapePartial[] = [];
	let indexCursor = 0;

	for ( const item of topLevelItems ) {
		if ( item.kind === 'widget' ) {
			shapes.push(
				deskWidgetToCanvasShape( item.widget, undefined, renderIndices[ indexCursor ] )
			);
			indexCursor += 1;
			continue;
		}

		const memberIndices = renderIndices.slice( indexCursor, indexCursor + item.widgets.length );
		for ( const widget of item.widgets ) {
			const stackMember = stackMembers.get( widget.id );
			if ( ! stackMember ) {
				continue;
			}
			shapes.push(
				deskWidgetToCanvasShape(
					widget,
					stackMember,
					memberIndices[ item.widgets.length - stackMember.order - 1 ]
				)
			);
		}
		indexCursor += item.widgets.length;
	}

	return shapes;
}

export function deskConfigToCanvasConnectorShapes(
	desk: DeskConfig,
	widgetShapes = deskConfigToCanvasShapes( desk )
): TLShapePartial< TLArrowShape >[] {
	if ( ! desk.connectors?.length ) {
		return [];
	}

	const lowestWidgetIndex = getLowestShapeIndex( widgetShapes );
	const connectorIndices = lowestWidgetIndex
		? getIndicesBelow( lowestWidgetIndex, desk.connectors.length )
		: getIndicesAbove( null, desk.connectors.length );

	return desk.connectors.map( ( connector, index ) => ( {
		id: createShapeId( `${ CONNECTOR_SHAPE_ID_PREFIX }${ connector.id }` ),
		type: 'arrow',
		index: connectorIndices[ index ],
		isLocked: true,
		opacity: 0.72,
		meta: {
			studioDeskOrigin: DERIVED_WIDGET_ORIGIN,
			studioDeskPersist: DERIVED_WIDGET_PERSIST,
			studioDeskConnector: true,
		},
		props: {
			kind: 'arc',
			color: CONNECTOR_COLOR,
			dash: 'solid',
			size: 'm',
			bend: connector.bend ?? 24,
			arrowheadStart: 'none',
			arrowheadEnd: 'none',
			start: { x: 0, y: 0 },
			end: { x: 2, y: 0 },
		},
	} ) );
}

export function deskConfigToCanvasConnectorBindings(
	desk: DeskConfig
): TLBindingCreate< TLArrowBinding >[] {
	if ( ! desk.connectors?.length ) {
		return [];
	}

	return desk.connectors.flatMap( ( connector ) => {
		const arrowId = createShapeId( `${ CONNECTOR_SHAPE_ID_PREFIX }${ connector.id }` );
		return [
			{
				type: 'arrow' as const,
				fromId: arrowId,
				toId: createShapeId( connector.from.widgetId ),
				props: {
					terminal: 'start' as const,
					normalizedAnchor: connector.from.normalizedAnchor,
					isExact: false,
					isPrecise: false,
					snap: 'none' as const,
				},
			},
			{
				type: 'arrow' as const,
				fromId: arrowId,
				toId: createShapeId( connector.to.widgetId ),
				props: {
					terminal: 'end' as const,
					normalizedAnchor: connector.to.normalizedAnchor,
					isExact: false,
					isPrecise: false,
					snap: 'none' as const,
				},
			},
		];
	} );
}

export function deskWidgetToCanvasShape(
	widget: DeskWidget,
	stackMember?: DeskStackMember,
	renderIndex?: TLShapePartial[ 'index' ]
): TLShapePartial {
	const definition = getWidgetDefinition( widget.type );
	if ( ! definition ) {
		throw new Error( `Unknown desk widget type: ${ widget.type }.` );
	}

	const stackLayout = stackMember
		? getStackMemberLayout( stackMember.stack, stackMember.order )
		: null;

	return {
		id: createShapeId( widget.id ),
		type: RECTANGLE_WIDGET_SHAPE_TYPE,
		x: stackLayout?.x ?? widget.x,
		y: stackLayout?.y ?? widget.y,
		rotation: stackLayout?.rotation ?? widget.rotation ?? 0,
		index:
			renderIndex ??
			( stackMember
				? getStackMemberZIndex( stackMember.stack.zIndex, stackMember.order )
				: ( widget.zIndex as TLShapePartial[ 'index' ] ) ),
		meta: stackMember
			? createStackMeta( stackMember.stack.id, stackMember.order, widget.zIndex )
			: undefined,
		props: {
			widgetType: widget.type,
			shapeProps: widget.shapeProps,
			widgetProps: widget.widgetProps,
		},
	};
}

export function resolvedDeskWidgetToCanvasShape(
	resolvedWidget: ResolvedDeskWidget< DeskWidget >,
	stackMember?: DeskStackMember
): TLShapePartial {
	const shape = deskWidgetToCanvasShape( resolvedWidget.widget, stackMember );
	if ( resolvedWidget.origin.kind !== 'derived' ) {
		return shape;
	}

	return {
		...shape,
		meta: {
			...( shape.meta ?? {} ),
			studioDeskOrigin: DERIVED_WIDGET_ORIGIN,
			studioDeskPersist: DERIVED_WIDGET_PERSIST,
			studioDeskSourceWidgetId: resolvedWidget.origin.sourceWidgetId,
			studioDeskDerivedKey: resolvedWidget.origin.key,
		},
	};
}

type TopLevelDeskItem =
	| {
			kind: 'widget';
			zIndex: string;
			widget: DeskWidget;
	  }
	| {
			kind: 'stack';
			zIndex: string;
			stack: DeskStack;
			widgets: DeskWidget[];
	  };

function getTopLevelDeskItems( desk: DeskConfig ) {
	const widgetsById = new Map( desk.widgets.map( ( widget ) => [ widget.id, widget ] ) );
	const stackedWidgetIds = new Set< string >();
	const items: TopLevelDeskItem[] = [];

	for ( const stack of desk.stacks ?? [] ) {
		const widgets = stack.memberIds
			.map( ( memberId ) => widgetsById.get( memberId ) )
			.filter( ( widget ): widget is DeskWidget => Boolean( widget ) );
		if ( widgets.length === 0 ) {
			continue;
		}

		widgets.forEach( ( widget ) => stackedWidgetIds.add( widget.id ) );
		items.push( {
			kind: 'stack',
			zIndex: stack.zIndex,
			stack,
			widgets,
		} );
	}

	for ( const widget of desk.widgets ) {
		if ( stackedWidgetIds.has( widget.id ) ) {
			continue;
		}

		items.push( {
			kind: 'widget',
			zIndex: widget.zIndex,
			widget,
		} );
	}

	return items.sort( ( first, second ) =>
		sortByIndex(
			{ index: first.zIndex as TLShape[ 'index' ] },
			{ index: second.zIndex as TLShape[ 'index' ] }
		)
	);
}

function getLowestShapeIndex( shapes: TLShapePartial[] ) {
	return [ ...shapes ]
		.filter(
			( shape ): shape is TLShapePartial & { index: NonNullable< TLShapePartial[ 'index' ] > } =>
				Boolean( shape.index )
		)
		.sort( sortByIndex )
		.at( 0 )?.index;
}

export function canvasShapeToDeskWidget( shape: TLShape ): DeskWidget | null {
	if (
		shape.type !== RECTANGLE_WIDGET_SHAPE_TYPE ||
		! isRectangleWidgetCanvasProps( shape.props )
	) {
		return null;
	}

	const definition = getWidgetDefinition( shape.props.widgetType );
	if ( ! definition || ! definition.isWidgetProps( shape.props.widgetProps ) ) {
		return null;
	}

	return {
		id: shape.id.startsWith( SHAPE_ID_PREFIX )
			? shape.id.slice( SHAPE_ID_PREFIX.length )
			: shape.id,
		type: shape.props.widgetType,
		...getPersistedShapePosition( shape ),
		rotation: shape.rotation || undefined,
		zIndex: getPersistedShapeZIndex( shape ),
		shapeProps: shape.props.shapeProps,
		widgetProps: shape.props.widgetProps,
	} as unknown as DeskWidget;
}

export function canvasShapesToDeskStacks( shapes: TLShape[] ): DeskStack[] {
	const shapesByStackId = new Map< string, TLShape[] >();

	for ( const shape of shapes ) {
		if ( ! isPersistentDeskCanvasShape( shape ) || canvasShapeToDeskWidget( shape ) === null ) {
			continue;
		}

		const stackId = getStackId( shape );
		if ( ! stackId ) {
			continue;
		}

		shapesByStackId.set( stackId, [ ...( shapesByStackId.get( stackId ) ?? [] ), shape ] );
	}

	return Array.from( shapesByStackId, ( [ stackId, stackShapes ] ) =>
		canvasShapesToDeskStack( stackId, stackShapes )
	).filter( ( stack ): stack is DeskStack => stack !== null );
}

export function isPersistentDeskCanvasShape( shape: TLShape ) {
	return ! isDerivedDeskCanvasRecord( shape );
}

export function isDerivedDeskCanvasRecord( value: unknown ) {
	const meta = getRecordMeta( value ) as DeskCanvasMeta | null;
	return (
		meta?.studioDeskOrigin === DERIVED_WIDGET_ORIGIN &&
		meta.studioDeskPersist === DERIVED_WIDGET_PERSIST
	);
}

export function getDerivedDeskCanvasRecordSourceId( value: unknown ) {
	const meta = getRecordMeta( value ) as DeskCanvasMeta | null;
	if ( ! isDerivedDeskCanvasRecord( value ) ) {
		return null;
	}
	return typeof meta?.studioDeskSourceWidgetId === 'string' ? meta.studioDeskSourceWidgetId : null;
}

export function getDerivedDeskCanvasRecordKey( value: unknown ) {
	const meta = getRecordMeta( value ) as DeskCanvasMeta | null;
	if ( ! isDerivedDeskCanvasRecord( value ) ) {
		return null;
	}
	return typeof meta?.studioDeskDerivedKey === 'string' ? meta.studioDeskDerivedKey : null;
}

export function getDeskCanvasRecordResolutionState( value: unknown ) {
	const meta = getRecordMeta( value ) as DeskCanvasMeta | null;
	return meta?.studioDeskResolutionState === 'loading' ? meta.studioDeskResolutionState : undefined;
}

export function getDeskCanvasRecordMetaWithResolutionState(
	value: unknown,
	resolutionState?: WidgetResolutionState
): TLShapePartial[ 'meta' ] {
	const nextMeta = { ...( getRecordMeta( value ) ?? {} ) };
	if ( resolutionState ) {
		nextMeta.studioDeskResolutionState = resolutionState;
	} else {
		nextMeta.studioDeskResolutionState = null;
	}
	return nextMeta as TLShapePartial[ 'meta' ];
}

export function hasOnlyDeskCanvasRecordResolutionStateChange(
	previousRecord: unknown,
	nextRecord: unknown
) {
	return (
		getDeskCanvasRecordResolutionState( previousRecord ) !==
			getDeskCanvasRecordResolutionState( nextRecord ) &&
		JSON.stringify( getRecordWithoutResolutionState( previousRecord ) ) ===
			JSON.stringify( getRecordWithoutResolutionState( nextRecord ) )
	);
}

export function canvasCameraToDeskViewport(
	camera: Pick< TLCamera, 'x' | 'y' | 'z' >
): DeskViewport {
	return {
		x: camera.x,
		y: camera.y,
		z: camera.z,
	};
}

function getStackMembersByWidgetId( stacks: DeskStack[] | undefined ) {
	const stackMembers = new Map< string, DeskStackMember >();

	for ( const stack of stacks ?? [] ) {
		stack.memberIds.forEach( ( memberId, order ) => {
			stackMembers.set( memberId, {
				stack,
				order,
			} );
		} );
	}

	return stackMembers;
}

function canvasShapesToDeskStack( stackId: string, shapes: TLShape[] ): DeskStack | null {
	const sortedShapes = shapes
		.map( ( shape ) => ( {
			shape,
			order: getStackOrder( shape ),
			widget: canvasShapeToDeskWidget( shape ),
		} ) )
		.filter(
			(
				item
			): item is {
				shape: TLShape;
				order: number;
				widget: DeskWidget;
			} => item.widget !== null
		)
		.sort( ( a, b ) => a.order - b.order );

	if ( sortedShapes.length < 2 ) {
		return null;
	}

	const firstMember = sortedShapes[ 0 ];
	const home = getStackHome( firstMember.shape );
	const anchor =
		home ??
		getStackAnchorFromMember(
			{
				...firstMember.shape,
				...getPersistedShapePosition( firstMember.shape ),
			},
			firstMember.order
		);

	return {
		id: stackId,
		x: anchor.x,
		y: anchor.y,
		zIndex: home?.zIndex ?? getStackZIndexFromMember( firstMember.shape.index, firstMember.order ),
		memberIds: sortedShapes.map( ( { widget } ) => widget.id ),
	};
}

function getPersistedShapePosition( shape: TLShape ) {
	const pushOrigin = getStackPushOrigin( shape );
	if ( pushOrigin ) {
		return {
			x: pushOrigin.x,
			y: pushOrigin.y,
		};
	}

	return {
		x: shape.x,
		y: shape.y,
	};
}

function getPersistedShapeZIndex( shape: TLShape ) {
	if ( getStackId( shape ) ) {
		return getStackOriginalZIndex( shape ) ?? shape.index;
	}

	return shape.index;
}

function isRectangleWidgetCanvasProps(
	props: TLShape[ 'props' ]
): props is RectangleWidgetCanvasProps {
	const candidate = props as Partial< RectangleWidgetCanvasProps >;
	return (
		typeof candidate.widgetType === 'string' &&
		isRectangleWidgetShapeProps( candidate.shapeProps ) &&
		Boolean( candidate.widgetProps ) &&
		typeof candidate.widgetProps === 'object'
	);
}

function getRecordMeta( value: unknown ) {
	if ( ! value || typeof value !== 'object' ) {
		return null;
	}

	const meta = ( value as { meta?: unknown } ).meta;
	return meta && typeof meta === 'object' ? ( meta as Record< string, unknown > ) : null;
}

function getRecordWithoutResolutionState( value: unknown ) {
	if ( ! value || typeof value !== 'object' ) {
		return value;
	}

	return {
		...( value as Record< string, unknown > ),
		meta: getDeskCanvasRecordMetaWithResolutionState( value ),
	};
}
