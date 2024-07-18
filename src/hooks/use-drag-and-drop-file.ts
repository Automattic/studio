import { useEffect, useRef, useState } from 'react';

export function useDragAndDropFile< T extends HTMLElement >( {
	onFileDrop,
}: {
	onFileDrop: ( file: File ) => void;
} ) {
	const dropRef = useRef< T >( null );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	useEffect( () => {
		if ( ! dropRef.current ) {
			return;
		}
		const handleDragLeave = ( event: DragEvent ) => {
			event.preventDefault();
			setIsDraggingOver( false );
		};
		const handleDragOver = ( event: DragEvent ) => {
			event.preventDefault();
			setIsDraggingOver( true );
		};
		const handleDrop = ( event: DragEvent ) => {
			event.preventDefault();
			event.stopPropagation();
			if ( ! event.dataTransfer ) {
				return;
			}

			if ( event.dataTransfer.files.length === 1 ) {
				onFileDrop( event.dataTransfer.files[ 0 ] );
			}
		};
		dropRef.current.addEventListener( 'dragover', handleDragOver );
		dropRef.current.addEventListener( 'dragleave', handleDragLeave );
		dropRef.current.addEventListener( 'drop', handleDrop );

		function cleanup() {
			if ( ! dropRef.current ) {
				return;
			}
			dropRef.current.removeEventListener( 'dragenter', handleDragOver );
			dropRef.current.removeEventListener( 'dragleave', handleDragLeave );
			dropRef.current.removeEventListener( 'drop', handleDrop );
		}
		return cleanup;
	}, [ onFileDrop ] );

	return { dropRef, isDraggingOver };
}
