import { useEffect, useRef, useState } from 'react';

export function useDragAndDropFile< T extends HTMLElement >( {
	onFileDrop,
}: {
	onFileDrop: ( file: File ) => void;
} ) {
	const dropRef = useRef< T >( null );
	const [ isDraggingOver, setIsDraggingOver ] = useState( false );

	console.log( 'rendering', { isDraggingOver } );

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
	}, [ onFileDrop ] );

	return { dropRef, isDraggingOver };
}
