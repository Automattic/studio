import { useCallback, useEffect, useRef, useState } from 'react';

export function useDragAndDropFile< T extends HTMLElement >( {
	onFileDrop,
}: {
	onFileDrop: ( file: File ) => void;
} ) {
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	// Callers commonly pass a new inline callback on every render. Reading it through a
	// ref keeps listener binding independent of the callback's identity, so a re-render
	// can never leave the node without listeners.
	const onFileDropRef = useRef( onFileDrop );
	useEffect( () => {
		onFileDropRef.current = onFileDrop;
	}, [ onFileDrop ] );

	const cleanupRef = useRef< ( () => void ) | undefined >( undefined );

	// A callback ref binds listeners to whichever node is currently mounted: React calls it
	// with null on detach and with the new node on attach, so node swaps stay covered.
	const dropRef = useCallback( ( dropElement: T | null ) => {
		cleanupRef.current?.();
		cleanupRef.current = undefined;

		if ( ! dropElement ) {
			return;
		}

		let dragLeaveTimeout: NodeJS.Timeout | undefined;
		const handleDragLeave = ( event: DragEvent ) => {
			event.preventDefault();
			clearTimeout( dragLeaveTimeout );
			dragLeaveTimeout = setTimeout( () => {
				setIsDraggingOver( false );
			}, 100 );
		};
		const handleDragOver = ( event: DragEvent ) => {
			event.preventDefault();
			clearTimeout( dragLeaveTimeout );
			setIsDraggingOver( true );
		};
		const handleDrop = ( event: DragEvent ) => {
			event.preventDefault();
			event.stopPropagation();
			setIsDraggingOver( false );

			if ( ! event.dataTransfer ) {
				return;
			}

			if ( event.dataTransfer.files.length === 1 ) {
				onFileDropRef.current( event.dataTransfer.files[ 0 ] );
			}
		};

		dropElement.addEventListener( 'dragover', handleDragOver );
		dropElement.addEventListener( 'dragleave', handleDragLeave );
		dropElement.addEventListener( 'drop', handleDrop );

		cleanupRef.current = () => {
			dropElement.removeEventListener( 'dragover', handleDragOver );
			dropElement.removeEventListener( 'dragleave', handleDragLeave );
			dropElement.removeEventListener( 'drop', handleDrop );
			clearTimeout( dragLeaveTimeout );
		};
	}, [] );

	return { dropRef, isDraggingOver };
}
