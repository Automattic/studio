import { useEffect, useRef, useCallback } from 'react';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { setNoteFading, removeNote, clearTaskNotes } from 'src/stores/tasks-slice';

const FADE_DELAY_MS = 2000;

interface BrowserNoteOverlaysProps {
	taskId: string | null;
	getActiveIframe: () => HTMLIFrameElement | null;
}

export function BrowserNoteOverlays( { taskId, getActiveIframe }: BrowserNoteOverlaysProps ) {
	const dispatch = useAppDispatch();
	const notes = useRootSelector( ( state ) =>
		taskId ? state.tasks.activeNotesByTask[ taskId ] ?? [] : []
	);
	const prevTaskIdRef = useRef< string | null >( null );
	const completedTimers = useRef< Map< string, ReturnType< typeof setTimeout > > >( new Map() );

	const postToIframe = useCallback(
		( type: string, payload?: Record< string, unknown > ) => {
			const iframe = getActiveIframe();
			if ( iframe?.contentWindow ) {
				try {
					iframe.contentWindow.postMessage( { type, ...payload }, '*' );
				} catch {
					// cross-origin guard
				}
			}
		},
		[ getActiveIframe ]
	);

	// Clear overlays when task changes
	useEffect( () => {
		if ( prevTaskIdRef.current && prevTaskIdRef.current !== taskId ) {
			postToIframe( 'studio:notes:clear' );
			if ( prevTaskIdRef.current ) {
				dispatch( clearTaskNotes( { taskId: prevTaskIdRef.current } ) );
			}
		}
		prevTaskIdRef.current = taskId;
	}, [ taskId, postToIframe, dispatch ] );

	// Watch for completed notes and trigger fade lifecycle
	useEffect( () => {
		for ( const note of notes ) {
			if ( note.status === 'completed' && ! completedTimers.current.has( note.id ) ) {
				postToIframe( 'studio:notes:complete', { noteId: note.id } );
				const timer = setTimeout( () => {
					if ( taskId ) {
						dispatch( setNoteFading( { taskId, noteId: note.id } ) );
						postToIframe( 'studio:notes:remove', { noteId: note.id } );
						// Remove from Redux after CSS fade finishes
						setTimeout( () => {
							if ( taskId ) {
								dispatch( removeNote( { taskId, noteId: note.id } ) );
							}
						}, 600 );
					}
					completedTimers.current.delete( note.id );
				}, FADE_DELAY_MS );
				completedTimers.current.set( note.id, timer );
			}
		}
	}, [ notes, taskId, postToIframe, dispatch ] );

	// Cleanup timers on unmount
	useEffect( () => {
		const timers = completedTimers.current;
		return () => {
			for ( const timer of timers.values() ) {
				clearTimeout( timer );
			}
			timers.clear();
		};
	}, [] );

	return null;
}
