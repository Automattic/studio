import { useEffect } from 'react';
import { type TLEventInfo, useEditor } from 'tldraw';

export function TldrawHoverStateSync() {
	const editor = useEditor();

	useEffect( () => {
		// Work around a tldraw bug where a canvas mounted under an existing cursor can miss
		// pointerenter, leaving hover indicators hidden until focus changes.
		const markHoveringCanvas = ( info: TLEventInfo ) => {
			if ( info.type !== 'pointer' || info.name !== 'pointer_move' ) {
				return;
			}

			const instanceState = editor.getInstanceState();
			if ( instanceState.isCoarsePointer || instanceState.isHoveringCanvas === true ) {
				return;
			}

			editor.updateInstanceState( { isHoveringCanvas: true } );
		};
		const markNotHoveringCanvas = () => {
			if ( editor.getInstanceState().isHoveringCanvas === false ) {
				return;
			}

			editor.updateInstanceState( { isHoveringCanvas: false } );
		};
		const handleVisibilityChange = () => {
			if ( document.visibilityState === 'hidden' ) {
				markNotHoveringCanvas();
			}
		};

		editor.on( 'event', markHoveringCanvas );
		window.addEventListener( 'blur', markNotHoveringCanvas );
		document.addEventListener( 'visibilitychange', handleVisibilityChange );
		return () => {
			editor.off( 'event', markHoveringCanvas );
			window.removeEventListener( 'blur', markNotHoveringCanvas );
			document.removeEventListener( 'visibilitychange', handleVisibilityChange );
		};
	}, [ editor ] );

	return null;
}
