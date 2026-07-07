import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, MouseEventHandler } from 'react';

export interface PointerDragHandlers {
	// Called once on a valid primary-button mousedown, after preventDefault.
	// Return the starting scalar (e.g. the panel/content width at drag start),
	// or null to abort the drag (e.g. the container is not measurable yet).
	onStart: ( event: MouseEvent< HTMLElement > ) => number | null;
	// rAF-throttled. Receives the start scalar and the raw pixel delta
	// (clientX - startX); returns the new committed-to-state scalar. Direction
	// and clamping are the caller's concern.
	onMove: ( start: number, deltaX: number ) => number;
	// Called once on mouseup, with the latest scalar from the last onMove.
	// Persist here.
	onCommit: ( latest: number ) => void;
}

export interface PointerDragControls {
	isDragging: boolean;
	onMouseDown: MouseEventHandler< HTMLElement >;
	// Externally end an in-flight drag (e.g. the panel closed mid-drag). With
	// commit: false (the default) a later mouseup will NOT persist.
	cancel: ( options?: { commit?: boolean } ) => void;
}

// Value-agnostic pointer-drag plumbing shared by the resizable panels: primary-
// button filtering, rAF throttling, cursor/userSelect save+restore, document
// listener attach/detach, and teardown on unmount or external cancel. It knows
// nothing about widths, clamping, storage, edges, or measurement.
export function usePointerDrag( {
	onStart,
	onMove,
	onCommit,
}: PointerDragHandlers ): PointerDragControls {
	const [ isDragging, setIsDragging ] = useState( false );
	// Holds the active drag's teardown so it can be cancelled externally or on
	// unmount. Passing commit: false marks the drag dead so a trailing mouseup
	// is a no-op.
	const cancelRef = useRef< ( ( options?: { commit?: boolean } ) => void ) | null >( null );

	const onMouseDown = useCallback< MouseEventHandler< HTMLElement > >(
		( event ) => {
			if ( event.button !== 0 ) {
				return;
			}
			const start = onStart( event );
			if ( start === null ) {
				return;
			}
			event.preventDefault();
			cancelRef.current?.(); // tear down any prior drag

			const startX = event.clientX;
			const originalCursor = document.body.style.cursor;
			const originalUserSelect = document.body.style.userSelect;
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
			setIsDragging( true );

			let frame: number | undefined;
			let latest = start;
			let committed = false;

			const run = ( clientX: number ) => {
				latest = onMove( start, clientX - startX );
			};

			const handleMouseMove = ( moveEvent: globalThis.MouseEvent ) => {
				if ( frame !== undefined ) {
					window.cancelAnimationFrame( frame );
				}
				frame = window.requestAnimationFrame( () => run( moveEvent.clientX ) );
			};

			const cancel = ( { commit = false }: { commit?: boolean } = {} ) => {
				if ( frame !== undefined ) {
					window.cancelAnimationFrame( frame );
				}
				document.body.style.cursor = originalCursor;
				document.body.style.userSelect = originalUserSelect;
				document.removeEventListener( 'mousemove', handleMouseMove );
				document.removeEventListener( 'mouseup', handleMouseUp );
				if ( cancelRef.current === cancel ) {
					cancelRef.current = null;
				}
				if ( commit && ! committed ) {
					committed = true;
					onCommit( latest );
				}
				setIsDragging( false );
			};

			function handleMouseUp( upEvent: globalThis.MouseEvent ) {
				run( upEvent.clientX );
				cancel( { commit: true } );
			}

			cancelRef.current = cancel;
			document.addEventListener( 'mousemove', handleMouseMove );
			document.addEventListener( 'mouseup', handleMouseUp );
		},
		[ onStart, onMove, onCommit ]
	);

	const cancel = useCallback( ( options?: { commit?: boolean } ) => {
		cancelRef.current?.( options );
	}, [] );

	useEffect( () => {
		return () => cancelRef.current?.( { commit: false } );
	}, [] );

	return { isDragging, onMouseDown, cancel };
}
