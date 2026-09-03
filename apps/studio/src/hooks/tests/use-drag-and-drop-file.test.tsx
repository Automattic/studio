// To run tests, execute `npm run test -- src/hooks/tests/use-drag-and-drop-file.test.tsx` from the root directory

import { render, createEvent, fireEvent, renderHook, act } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { useDragAndDropFile } from 'src/hooks/use-drag-and-drop-file';

const DragComponent = ( { onFileDrop }: { onFileDrop: () => void } ) => {
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( { onFileDrop } );
	return (
		<div data-testid="test-drop-zone" ref={ dropRef }>
			{ isDraggingOver ? 'Dragging Over' : 'Not Dragging Over' }
		</div>
	);
};

// Mirrors the real caller, which passes a new inline callback on every render.
const InlineCallbackDragComponent = ( { onFileDrop }: { onFileDrop: ( file: File ) => void } ) => {
	const [ renderCount, setRenderCount ] = useState( 0 );
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => onFileDrop( file ),
	} );
	return (
		<div data-testid="test-drop-zone" ref={ dropRef }>
			<button onClick={ () => setRenderCount( renderCount + 1 ) }>rerender</button>
			{ isDraggingOver ? 'Dragging Over' : 'Not Dragging Over' }
		</div>
	);
};

// The ref'd node is replaced rather than updated in place, as a branch swap would do.
const RemountingDragComponent = ( { onFileDrop }: { onFileDrop: ( file: File ) => void } ) => {
	const [ nodeKey, setNodeKey ] = useState( 0 );
	const { dropRef, isDraggingOver } = useDragAndDropFile< HTMLDivElement >( {
		onFileDrop: ( file: File ) => onFileDrop( file ),
	} );
	return (
		<div>
			<button onClick={ () => setNodeKey( nodeKey + 1 ) }>remount</button>
			<div key={ nodeKey } data-testid="test-drop-zone" ref={ dropRef }>
				{ isDraggingOver ? 'Dragging Over' : 'Not Dragging Over' }
			</div>
		</div>
	);
};

describe( 'useDragAndDropFile', () => {
	const onFileDrop = vi.fn();
	beforeEach( () => {
		onFileDrop.mockReset();
		vi.useFakeTimers();
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
			vi.runAllTimers();
		} );

		expect( getByText( 'Not Dragging Over' ) ).toBeInTheDocument();
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

	test( 'should keep responding to dragover after a re-render with a new callback', () => {
		const { getByTestId, getByText } = render(
			<InlineCallbackDragComponent onFileDrop={ onFileDrop } />
		);
		const dropZone = getByTestId( 'test-drop-zone' );

		act( () => {
			fireEvent.click( getByText( 'rerender' ) );
		} );

		act( () => {
			fireEvent( dropZone, createEvent.dragOver( dropZone ) );
		} );

		expect( getByText( 'Dragging Over' ) ).toBeInTheDocument();
	} );

	test( 'should call the latest callback on drop after a re-render', () => {
		const { getByTestId, getByText } = render(
			<InlineCallbackDragComponent onFileDrop={ onFileDrop } />
		);
		const dropZone = getByTestId( 'test-drop-zone' );
		const file = new File( [ 'file contents' ], 'backup.zip', { type: 'application/zip' } );

		act( () => {
			fireEvent.click( getByText( 'rerender' ) );
		} );

		act( () => {
			fireEvent( dropZone, createEvent.drop( dropZone, { dataTransfer: { files: [ file ] } } ) );
		} );

		expect( onFileDrop ).toHaveBeenCalledTimes( 1 );
		expect( onFileDrop ).toHaveBeenCalledWith( file );
	} );

	test( 'should keep responding to dragover after the drop node is remounted', () => {
		const { getByTestId, getByText } = render(
			<RemountingDragComponent onFileDrop={ onFileDrop } />
		);

		act( () => {
			fireEvent.click( getByText( 'remount' ) );
		} );

		const dropZone = getByTestId( 'test-drop-zone' );
		act( () => {
			fireEvent( dropZone, createEvent.dragOver( dropZone ) );
		} );

		expect( getByText( 'Dragging Over' ) ).toBeInTheDocument();
	} );
} );
