// To run tests, execute `npm run test -- src/hooks/tests/use-drag-and-drop-file.test.tsx` from the root directory

import { render, createEvent, fireEvent, renderHook, act } from '@testing-library/react';
import { useDragAndDropFile } from '../use-drag-and-drop-file';

const DragComponent = ( { onFileDrop }: { onFileDrop: () => void } ) => {
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( { onFileDrop } );
	return (
		<div data-testid="test-drop-zone" ref={ dropRef }>
			{ isDraggingOver ? 'Dragging Over' : 'Not Dragging Over' }
		</div>
	);
};

describe( 'useDragAndDropFile', () => {
	const onFileDrop = jest.fn();
	beforeEach( () => {
		onFileDrop.mockReset();
	} );

	test( 'should initialize with isDraggingOver as false', () => {
		const { result } = renderHook( () => useDragAndDropFile( { onFileDrop } ) );
		expect( result.current.isDraggingOver ).toBe( false );
	} );
	test( 'should set isDraggingOver to true on dragover event', async () => {
		const { getByTestId, getByText } = render( <DragComponent onFileDrop={ onFileDrop } /> );
		const dropZone = getByTestId( 'test-drop-zone' );

		act( () => {
			const dragOverEvent = createEvent.dragOver( dropZone );
			fireEvent( dropZone, dragOverEvent );
		} );

		expect( getByText( 'Dragging Over' ) ).toBeInTheDocument();
	} );

	test( 'should set isDraggingOver to false on drag leave event', () => {
		jest.useFakeTimers();
		const { getByTestId, getByText } = render( <DragComponent onFileDrop={ onFileDrop } /> );
		const dropZone = getByTestId( 'test-drop-zone' );

		act( () => {
			const dragOverEvent = createEvent.dragOver( dropZone );
			fireEvent( dropZone, dragOverEvent );
		} );

		expect( getByText( 'Dragging Over' ) ).toBeInTheDocument();

		act( () => {
			const dragLeaveEvent = createEvent.dragLeave( dropZone );
			fireEvent( dropZone, dragLeaveEvent );
			jest.runAllTimers();
		} );

		expect( getByText( 'Not Dragging Over' ) ).toBeInTheDocument();

		jest.useRealTimers();
	} );

	test( 'should call onFileDrop with the dropped file on drop event', () => {
		const { getByTestId } = render( <DragComponent onFileDrop={ onFileDrop } /> );
		const dropZone = getByTestId( 'test-drop-zone' );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'applicaiton/zip' } );
		act( () => {
			const dropEvent = createEvent.drop( dropZone, { dataTransfer: { files: [ file ] } } );
			fireEvent( dropZone, dropEvent );
		} );
		expect( onFileDrop ).toHaveBeenCalledTimes( 1 );
		expect( onFileDrop ).toHaveBeenCalledWith( file );
	} );
} );
