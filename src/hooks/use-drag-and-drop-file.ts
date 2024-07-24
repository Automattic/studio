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
				onFileDrop( event.dataTransfer.files[ 0 ] );
			}
			setIsDraggingOver( false );
		};
		const handleDragEnd = ( event: DragEvent ) => {
			event.preventDefault();
			setIsDraggingOver( false );
		};

		const node = dropRef.current;

		node.addEventListener( 'dragover', handleDragOver );
		node.addEventListener( 'dragleave', handleDragLeave );
		node.addEventListener( 'drop', handleDrop );
		node.addEventListener( 'dragend', handleDragEnd );

		return () => {
			node.removeEventListener( 'dragover', handleDragOver );
			node.removeEventListener( 'dragleave', handleDragLeave );
			node.removeEventListener( 'drop', handleDrop );
			node.removeEventListener( 'dragend', handleDragEnd );
		};

		function cleanup() {
			if ( ! dropRef.current ) {
				return;
			}
			dropRef.current.removeEventListener( 'dragover', handleDragOver );
			dropRef.current.removeEventListener( 'dragleave', handleDragLeave );
			dropRef.current.removeEventListener( 'drop', handleDrop );
			clearTimeout( dragLeaveTimeout );
		}
		return cleanup;
	}, [ onFileDrop ] );

	return { dropRef, isDraggingOver };
}
