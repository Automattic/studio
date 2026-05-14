import { _n, sprintf } from '@wordpress/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useDesk } from '@/ui-desks/desk/provider';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import {
	createAnnotationFocusEntry,
	getAnnotationSubmission,
	getAnnotationWidgets,
	removeAnnotationWidget,
} from './notes';
import type { AnnotationPayload } from './inspector';
import type { DeskSitePreviewAnnotation } from './prompt';
import type { DeskWidget } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';

interface PendingAnnotation {
	widgetId: string;
	payload: AnnotationPayload;
}

interface AnnotationSubmission {
	annotations: DeskSitePreviewAnnotation[];
	previewWidget?: DeskWidget;
}

interface AnnotationsContextValue {
	annotatingWidgetId: string | null;
	annotationCount: number;
	selectedAnnotationWidgetId: string | null;
	pendingAnnotation: PendingAnnotation | null;
	startAnnotatingPreview: ( widgetId: string ) => boolean;
	stopAnnotatingPreview: () => boolean;
	requestAnnotation: ( widgetId: string, payload: AnnotationPayload ) => void;
	confirmPendingAnnotation: ( comment: string ) => boolean;
	cancelPendingAnnotation: () => void;
	removeSelectedAnnotation: () => boolean;
	collectAnnotationSubmission: () => AnnotationSubmission | null;
}

const AnnotationsContext = createContext< AnnotationsContextValue >( {
	annotatingWidgetId: null,
	annotationCount: 0,
	selectedAnnotationWidgetId: null,
	pendingAnnotation: null,
	startAnnotatingPreview: () => false,
	stopAnnotatingPreview: () => false,
	requestAnnotation: noopRequestAnnotation,
	confirmPendingAnnotation: () => false,
	cancelPendingAnnotation: noopCancelPendingAnnotation,
	removeSelectedAnnotation: () => false,
	collectAnnotationSubmission: () => null,
} );

export function AnnotationsProvider( { children }: { children: ReactNode } ) {
	const {
		focusMode,
		focusedWidget,
		getFocusDeskSnapshot,
		isReadOnly,
		selectedWidgetToolbarItem,
		setFocusDesk,
		startFocusMode,
		stopFocusMode,
	} = useDesk();
	const [ annotatingWidgetId, setAnnotatingWidgetId ] = useState< string | null >( null );
	const [ pendingAnnotation, setPendingAnnotation ] = useState< PendingAnnotation | null >( null );
	const isAnnotating =
		Boolean( annotatingWidgetId ) &&
		focusMode?.widgetId === annotatingWidgetId &&
		focusedWidget?.type === SITE_PREVIEW_WIDGET_TYPE;
	const focusDesk = isAnnotating ? focusMode?.focusDesk ?? null : null;
	const annotationWidgets = focusDesk ? getAnnotationWidgets( focusDesk ) : [];
	const annotationCount = annotationWidgets.length;
	const selectedAnnotationWidgetId =
		selectedWidgetToolbarItem?.kind === 'single-widget' &&
		annotationWidgets.some( ( widget ) => widget.id === selectedWidgetToolbarItem.widget.id )
			? selectedWidgetToolbarItem.widget.id
			: null;

	useEffect( () => {
		if ( annotatingWidgetId && focusMode?.widgetId !== annotatingWidgetId ) {
			setAnnotatingWidgetId( null );
			setPendingAnnotation( null );
		}
	}, [ annotatingWidgetId, focusMode?.widgetId ] );

	const startAnnotatingPreview = useCallback(
		( widgetId: string ) => {
			if ( ! startFocusMode( widgetId ) ) {
				return false;
			}
			setAnnotatingWidgetId( widgetId );
			setPendingAnnotation( null );
			return true;
		},
		[ startFocusMode ]
	);

	const stopAnnotatingPreview = useCallback( () => {
		setAnnotatingWidgetId( null );
		setPendingAnnotation( null );
		return stopFocusMode();
	}, [ stopFocusMode ] );

	const requestAnnotation = useCallback(
		( widgetId: string, payload: AnnotationPayload ) => {
			if ( widgetId !== annotatingWidgetId ) {
				return;
			}
			setPendingAnnotation( { widgetId, payload } );
		},
		[ annotatingWidgetId ]
	);

	const confirmPendingAnnotation = useCallback(
		( comment: string ) => {
			if ( isReadOnly || ! pendingAnnotation || ! isAnnotating || ! focusedWidget ) {
				return false;
			}
			const snapshot = getFocusDeskSnapshot() ?? focusMode?.focusDesk;
			if ( ! snapshot ) {
				return false;
			}
			const entry = createAnnotationFocusEntry(
				focusedWidget,
				pendingAnnotation.payload,
				comment,
				snapshot
			);
			if ( ! entry ) {
				return false;
			}
			const didUpdate = setFocusDesk( {
				...snapshot,
				widgets: [ ...snapshot.widgets, entry.widget ],
				connectors: [ ...( snapshot.connectors ?? [] ), entry.connector ],
			} );
			if ( didUpdate ) {
				setPendingAnnotation( null );
			}
			return didUpdate;
		},
		[
			focusMode?.focusDesk,
			focusedWidget,
			getFocusDeskSnapshot,
			isAnnotating,
			isReadOnly,
			pendingAnnotation,
			setFocusDesk,
		]
	);

	const cancelPendingAnnotation = useCallback( () => {
		setPendingAnnotation( null );
	}, [] );

	const removeSelectedAnnotation = useCallback( () => {
		if ( isReadOnly || ! selectedAnnotationWidgetId ) {
			return false;
		}
		const snapshot = getFocusDeskSnapshot() ?? focusDesk;
		if ( ! snapshot ) {
			return false;
		}
		return setFocusDesk( removeAnnotationWidget( snapshot, selectedAnnotationWidgetId ) );
	}, [ focusDesk, getFocusDeskSnapshot, isReadOnly, selectedAnnotationWidgetId, setFocusDesk ] );

	const collectAnnotationSubmission = useCallback( () => {
		return getAnnotationSubmission( focusedWidget, getFocusDeskSnapshot() ?? focusDesk );
	}, [ focusDesk, focusedWidget, getFocusDeskSnapshot ] );

	useEffect( () => {
		if ( ! isAnnotating ) {
			return;
		}

		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.key !== 'Escape' ) {
				return;
			}
			if ( pendingAnnotation ) {
				event.preventDefault();
				setPendingAnnotation( null );
				return;
			}
			if ( annotationCount > 0 ) {
				event.preventDefault();
				const shouldDiscard = window.confirm(
					sprintf(
						_n( 'Discard %d annotation?', 'Discard %d annotations?', annotationCount ),
						annotationCount
					)
				);
				if ( ! shouldDiscard ) {
					return;
				}
			}
			event.preventDefault();
			stopAnnotatingPreview();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ annotationCount, isAnnotating, pendingAnnotation, stopAnnotatingPreview ] );

	const value = useMemo(
		() => ( {
			annotatingWidgetId: isAnnotating ? annotatingWidgetId : null,
			annotationCount,
			selectedAnnotationWidgetId,
			pendingAnnotation,
			startAnnotatingPreview,
			stopAnnotatingPreview,
			requestAnnotation,
			confirmPendingAnnotation,
			cancelPendingAnnotation,
			removeSelectedAnnotation,
			collectAnnotationSubmission,
		} ),
		[
			annotationCount,
			annotatingWidgetId,
			cancelPendingAnnotation,
			collectAnnotationSubmission,
			confirmPendingAnnotation,
			isAnnotating,
			pendingAnnotation,
			removeSelectedAnnotation,
			requestAnnotation,
			selectedAnnotationWidgetId,
			startAnnotatingPreview,
			stopAnnotatingPreview,
		]
	);

	return <AnnotationsContext.Provider value={ value }>{ children }</AnnotationsContext.Provider>;
}

export function useAnnotations() {
	return useContext( AnnotationsContext );
}

function noopRequestAnnotation() {}
function noopCancelPendingAnnotation() {}
