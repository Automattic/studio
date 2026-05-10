import { useRegistry } from '@wordpress/data';
import { useEffect, useRef } from 'react';
import {
	canvasShapeToDeskWidget,
	getDerivedDeskCanvasRecordKey,
	getDerivedDeskCanvasRecordSourceId,
	getDeskCanvasRecordMetaWithResolutionState,
	hasOnlyDeskCanvasRecordResolutionStateChange,
	isDerivedDeskCanvasRecord,
	resolvedDeskWidgetToCanvasShape,
} from '@/ui-desks/desk/tldraw-adapter';
import { isStackExpanded } from '@/ui-desks/stacks/utils';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import { getCurrentDeskWidgets } from './editor-state';
import type {
	DeskWidget,
	ResolvedDeskStack,
	ResolvedDeskWidget,
	WidgetResolverContext,
	WidgetResolution,
	WidgetResolutionState,
} from '@/ui-desks/widgets/types';
import type { Editor, TLShape, TLShapePartial } from 'tldraw';

interface UseDeskWidgetResolversOptions {
	editor: Editor | null;
	isEnabled: boolean;
}

interface ResolvedWidgetState {
	sourceWidget: DeskWidget;
	identity: unknown;
	widgets: Array< ResolvedDeskWidget< DeskWidget > >;
	stacks: ResolvedDeskStack[];
}

interface CanvasStoreChanges {
	added: Record< string, unknown >;
	updated: Record< string, readonly [ unknown, unknown ] >;
	removed: Record< string, unknown >;
}

const RESOLVE_DEBOUNCE_MS = 80;

export function useDeskWidgetResolvers( { editor, isEnabled }: UseDeskWidgetResolversOptions ) {
	const registry = useRegistry();
	const resolvedStateRef = useRef( new Map< string, ResolvedWidgetState >() );

	useEffect( () => {
		if ( ! editor || ! isEnabled ) {
			return;
		}

		const context: WidgetResolverContext = { registry };
		let isCancelled = false;
		let isRunning = false;
		let shouldRunAgain = false;
		let resolveTimer: ReturnType< typeof setTimeout > | null = null;

		const runResolvers = async () => {
			if ( isRunning ) {
				shouldRunAgain = true;
				return;
			}

			isRunning = true;
			do {
				shouldRunAgain = false;
				await resolveDeskWidgets( editor, context, resolvedStateRef.current, () => isCancelled );
			} while ( shouldRunAgain && ! isCancelled && ! editor.isDisposed );
			isRunning = false;
		};

		const scheduleResolve = () => {
			if ( resolveTimer ) {
				clearTimeout( resolveTimer );
			}
			resolveTimer = setTimeout( () => {
				resolveTimer = null;
				void runResolvers();
			}, RESOLVE_DEBOUNCE_MS );
		};

		const unsubscribeEditor = editor.store.listen(
			( { changes } ) => {
				if ( ! isRunning ) {
					deleteSourceWidgetsForRemovedDerivedStacks( editor, changes );
				}
				if ( hasResolverRelevantDocumentChange( changes ) ) {
					scheduleResolve();
				}
			},
			{ scope: 'document' }
		);
		const unsubscribeRegistry = registry.subscribe( scheduleResolve );

		scheduleResolve();

		return () => {
			isCancelled = true;
			if ( resolveTimer ) {
				clearTimeout( resolveTimer );
			}
			unsubscribeEditor();
			unsubscribeRegistry();
		};
	}, [ editor, isEnabled, registry ] );
}

async function resolveDeskWidgets(
	editor: Editor,
	context: WidgetResolverContext,
	resolvedState: Map< string, ResolvedWidgetState >,
	isCancelled: () => boolean
) {
	const authoredWidgets = getAuthoredDeskWidgets( editor );
	const activeResolverIds = new Set< string >();

	for ( const widget of authoredWidgets ) {
		const definition = getWidgetDefinition( widget.type );
		if ( ! definition?.resolver ) {
			continue;
		}

		activeResolverIds.add( widget.id );
		const previousState = resolvedState.get( widget.id );
		if ( previousState && ! shouldResolveWidget( definition, widget, previousState, context ) ) {
			continue;
		}
		const isInitialResolve = ! previousState;

		if ( isInitialResolve && definition.loading ) {
			setSourceWidgetResolutionState(
				editor,
				widget.id,
				'loading',
				getLoadingShapeProps( definition, widget )
			);
		}

		let resolution: WidgetResolution;
		try {
			resolution = ( await definition.resolver.resolve(
				widget as never,
				context
			) ) as WidgetResolution;
		} catch ( error ) {
			if ( isInitialResolve ) {
				setSourceWidgetResolutionState(
					editor,
					widget.id,
					undefined,
					definition.getInitialWidget().shapeProps
				);
			}
			console.warn( `Failed to resolve desk widget "${ widget.id }".`, error );
			if ( ! previousState ) {
				deleteDerivedWidgetsForSource( editor, widget.id );
			}
			continue;
		}
		if ( isCancelled() || editor.isDisposed ) {
			return;
		}
		if ( ! getAuthoredDeskWidgets( editor ).some( ( candidate ) => candidate.id === widget.id ) ) {
			continue;
		}
		if ( isInitialResolve ) {
			setSourceWidgetResolutionState(
				editor,
				widget.id,
				undefined,
				definition.getInitialWidget().shapeProps
			);
		}
		const widgets = resolution.widgets.filter(
			( resolvedWidget ): resolvedWidget is ResolvedDeskWidget< DeskWidget > =>
				isDerivedFromWidget( resolvedWidget, widget.id )
		);
		const stacks = ( resolution.stacks ?? [] ).filter( ( resolvedStack ) =>
			isDerivedStackFromWidget( resolvedStack, widget.id, widgets )
		);

		reconcileResolvedWidgets( editor, widget.id, widgets, stacks );
		resolvedState.set( widget.id, {
			sourceWidget: widget,
			identity: resolution.identity,
			widgets,
			stacks,
		} );
	}

	for ( const sourceWidgetId of Array.from( resolvedState.keys() ) ) {
		if ( activeResolverIds.has( sourceWidgetId ) ) {
			continue;
		}
		deleteDerivedWidgetsForSource( editor, sourceWidgetId );
		resolvedState.delete( sourceWidgetId );
	}
}

function shouldResolveWidget(
	definition: NonNullable< ReturnType< typeof getWidgetDefinition > >,
	widget: DeskWidget,
	previousState: ResolvedWidgetState,
	context: WidgetResolverContext
) {
	if ( JSON.stringify( previousState.sourceWidget ) !== JSON.stringify( widget ) ) {
		return true;
	}

	try {
		return Boolean(
			definition.resolver?.invalidate( widget as never, previousState.identity as never, context )
		);
	} catch {
		return true;
	}
}

function getAuthoredDeskWidgets( editor: Editor ) {
	return getCurrentDeskWidgets( editor );
}

function getLoadingShapeProps(
	definition: NonNullable< ReturnType< typeof getWidgetDefinition > >,
	widget: DeskWidget
) {
	return (
		definition.getLoadingShapeProps?.( widget as never ) ?? definition.getInitialWidget().shapeProps
	);
}

function reconcileResolvedWidgets(
	editor: Editor,
	sourceWidgetId: string,
	widgets: Array< ResolvedDeskWidget< DeskWidget > >,
	stacks: ResolvedDeskStack[] = []
) {
	const existingShapes = getDerivedShapesForSource( editor, sourceWidgetId );
	const existingByKey = new Map(
		existingShapes
			.map( ( shape ) => [ getDerivedDeskCanvasRecordKey( shape ), shape ] as const )
			.filter( ( entry ): entry is readonly [ string, TLShape ] => entry[ 0 ] !== null )
	);
	const nextKeys = new Set< string >();
	const shapesToCreate: TLShapePartial[] = [];
	const shapesToUpdate: TLShapePartial[] = [];
	const stackMembers = getResolvedStackMembers( widgets, stacks );

	for ( const resolvedWidget of widgets ) {
		if ( resolvedWidget.origin.kind !== 'derived' ) {
			continue;
		}
		nextKeys.add( resolvedWidget.origin.key );
		const nextShape = resolvedDeskWidgetToCanvasShape(
			resolvedWidget,
			stackMembers.get( resolvedWidget.widget.id )
		);
		const existingShape = existingByKey.get( resolvedWidget.origin.key );

		if ( existingShape ) {
			const updateShape = preserveExpandedStackMemberState( existingShape, {
				...nextShape,
				id: existingShape.id,
			} );
			if ( shouldUpdateShape( existingShape, updateShape ) ) {
				shapesToUpdate.push( updateShape );
			}
			continue;
		}

		if ( nextShape.id && editor.getShape( nextShape.id ) ) {
			const existingShapeById = editor.getShape( nextShape.id ) as TLShape;
			const updateShape = preserveExpandedStackMemberState( existingShapeById, nextShape );
			if ( shouldUpdateShape( existingShapeById, updateShape ) ) {
				shapesToUpdate.push( updateShape );
			}
			continue;
		}

		shapesToCreate.push( nextShape );
	}

	const shapesToDelete = existingShapes
		.filter( ( shape ) => {
			const key = getDerivedDeskCanvasRecordKey( shape );
			return ! key || ! nextKeys.has( key );
		} )
		.map( ( shape ) => shape.id );

	if ( shapesToDelete.length > 0 ) {
		editor.deleteShapes( shapesToDelete );
	}
	if ( shapesToUpdate.length > 0 ) {
		editor.updateShapes( shapesToUpdate );
	}
	if ( shapesToCreate.length > 0 ) {
		editor.createShapes( shapesToCreate );
	}
}

function preserveExpandedStackMemberState(
	existingShape: TLShape,
	nextShape: TLShapePartial
): TLShapePartial {
	if ( ! isStackExpanded( existingShape ) ) {
		return nextShape;
	}

	return {
		...nextShape,
		x: existingShape.x,
		y: existingShape.y,
		rotation: existingShape.rotation,
		index: existingShape.index,
	};
}

function deleteDerivedWidgetsForSource( editor: Editor, sourceWidgetId: string ) {
	const shapes = getDerivedShapesForSource( editor, sourceWidgetId );
	if ( shapes.length > 0 ) {
		editor.deleteShapes( shapes.map( ( shape ) => shape.id ) );
	}
}

function setSourceWidgetResolutionState(
	editor: Editor,
	sourceWidgetId: string,
	resolutionState?: WidgetResolutionState,
	shapeProps?: DeskWidget[ 'shapeProps' ]
) {
	const sourceShape = editor
		.getCurrentPageShapes()
		.find( ( shape ) => canvasShapeToDeskWidget( shape )?.id === sourceWidgetId );
	if ( ! sourceShape ) {
		return;
	}

	editor.updateShape( {
		id: sourceShape.id,
		type: sourceShape.type,
		meta: getDeskCanvasRecordMetaWithResolutionState( sourceShape, resolutionState ),
		...( shapeProps
			? {
					props: {
						shapeProps,
					},
			  }
			: {} ),
	} );
}

function getDerivedShapesForSource( editor: Editor, sourceWidgetId: string ) {
	return editor
		.getCurrentPageShapes()
		.filter( ( shape ) => getDerivedDeskCanvasRecordSourceId( shape ) === sourceWidgetId );
}

function deleteSourceWidgetsForRemovedDerivedStacks( editor: Editor, changes: CanvasStoreChanges ) {
	const sourceWidgetIds = new Set(
		Object.values( changes.removed )
			.map( getDerivedDeskCanvasRecordSourceId )
			.filter( ( sourceWidgetId ): sourceWidgetId is string => sourceWidgetId !== null )
	);
	if ( sourceWidgetIds.size === 0 ) {
		return;
	}

	const sourceShapeIds = Array.from( sourceWidgetIds ).flatMap( ( sourceWidgetId ) => {
		if ( getDerivedShapesForSource( editor, sourceWidgetId ).length > 0 ) {
			return [];
		}

		const sourceShape = editor
			.getCurrentPageShapes()
			.find( ( shape ) => canvasShapeToDeskWidget( shape )?.id === sourceWidgetId );
		return sourceShape ? [ sourceShape.id ] : [];
	} );

	if ( sourceShapeIds.length > 0 ) {
		editor.deleteShapes( sourceShapeIds );
	}
}

function shouldUpdateShape( currentShape: TLShape, nextShape: TLShapePartial ) {
	if (
		( typeof nextShape.x === 'number' && currentShape.x !== nextShape.x ) ||
		( typeof nextShape.y === 'number' && currentShape.y !== nextShape.y ) ||
		( typeof nextShape.rotation === 'number' && currentShape.rotation !== nextShape.rotation ) ||
		( nextShape.index && currentShape.index !== nextShape.index )
	) {
		return true;
	}

	if (
		nextShape.props &&
		JSON.stringify( currentShape.props ) !== JSON.stringify( nextShape.props )
	) {
		return true;
	}

	return Boolean( nextShape.meta && ! hasMatchingMeta( currentShape, nextShape.meta ) );
}

function hasMatchingMeta( shape: TLShape, meta: TLShapePartial[ 'meta' ] ) {
	const currentMeta = shape.meta as Record< string, unknown >;
	return Object.entries( meta ?? {} ).every( ( [ key, value ] ) => currentMeta[ key ] === value );
}

function isDerivedFromWidget( resolvedWidget: ResolvedDeskWidget, sourceWidgetId: string ) {
	return (
		resolvedWidget.origin.kind === 'derived' &&
		resolvedWidget.origin.sourceWidgetId === sourceWidgetId
	);
}

function isDerivedStackFromWidget(
	resolvedStack: ResolvedDeskStack,
	sourceWidgetId: string,
	widgets: Array< ResolvedDeskWidget< DeskWidget > >
) {
	if ( resolvedStack.origin.sourceWidgetId !== sourceWidgetId ) {
		return false;
	}

	const widgetIds = new Set( widgets.map( ( resolvedWidget ) => resolvedWidget.widget.id ) );
	return resolvedStack.stack.memberIds.every( ( memberId ) => widgetIds.has( memberId ) );
}

function getResolvedStackMembers(
	widgets: Array< ResolvedDeskWidget< DeskWidget > >,
	stacks: ResolvedDeskStack[]
) {
	const stackMembers = new Map< string, { stack: ResolvedDeskStack[ 'stack' ]; order: number } >();
	const widgetIds = new Set( widgets.map( ( resolvedWidget ) => resolvedWidget.widget.id ) );

	for ( const { stack } of stacks ) {
		stack.memberIds.forEach( ( memberId, order ) => {
			if ( widgetIds.has( memberId ) ) {
				stackMembers.set( memberId, { stack, order } );
			}
		} );
	}

	return stackMembers;
}

function hasResolverRelevantDocumentChange( changes: CanvasStoreChanges ) {
	if (
		[ ...Object.values( changes.added ), ...Object.values( changes.removed ) ].some(
			( record ) => isShapeRecord( record ) && ! isDerivedDeskCanvasRecord( record )
		)
	) {
		return true;
	}

	return Object.values( changes.updated ).some(
		( [ previousRecord, nextRecord ] ) =>
			! hasOnlyDeskCanvasRecordResolutionStateChange( previousRecord, nextRecord ) &&
			( ( isShapeRecord( previousRecord ) && ! isDerivedDeskCanvasRecord( previousRecord ) ) ||
				( isShapeRecord( nextRecord ) && ! isDerivedDeskCanvasRecord( nextRecord ) ) )
	);
}

function isShapeRecord( value: unknown ) {
	return (
		Boolean( value ) &&
		typeof value === 'object' &&
		( value as { typeName?: unknown } ).typeName === 'shape'
	);
}
