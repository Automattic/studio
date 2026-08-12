import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import { StudioCodePanel } from './studio-code-panel';

vi.mock( '@wordpress/dataviews', () => ( {
	DataForm: ( {
		data,
		onChange,
	}: {
		data: { content: string };
		onChange: ( update: { content: string } ) => void;
	} ) => (
		<textarea
			aria-label="Instructions"
			value={ data.content }
			onChange={ ( event ) => onChange( { content: event.target.value } ) }
		/>
	),
} ) );

vi.mock( '@/data/queries/use-agent-instructions', () => ( {
	useAgentInstructions: vi.fn(),
	useSaveAgentInstructions: vi.fn(),
} ) );

const useAgentInstructionsMock = vi.mocked( useAgentInstructions );
const useSaveAgentInstructionsMock = vi.mocked( useSaveAgentInstructions );

// Renderer only. The `apps/local` connector drops `editSession`, so these passing is not evidence the
// Tracks event fires under `studio ui`. See STU-2247.
describe( 'StudioCodePanel', () => {
	const save = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		useAgentInstructionsMock.mockReturnValue( { data: 'Answer in French.' } as never );
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: false } as never );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'saves once after the user stops typing, not on every keystroke', () => {
		render( <StudioCodePanel /> );

		const textarea = screen.getByLabelText( 'Instructions' );
		fireEvent.change( textarea, { target: { value: 'Answer in Spanish' } } );
		fireEvent.change( textarea, { target: { value: 'Answer in Spanish.' } } );

		expect( save ).not.toHaveBeenCalled();

		act( () => void vi.advanceTimersByTime( 800 ) );

		expect( save ).toHaveBeenCalledTimes( 1 );
		expect( save ).toHaveBeenCalledWith( { content: 'Answer in Spanish.' } );
	} );

	it( 'flushes a pending edit when the panel unmounts mid-debounce', () => {
		const { unmount } = render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Half-typed thought' },
		} );
		unmount();

		expect( save ).toHaveBeenCalledExactlyOnceWith( {
			content: 'Half-typed thought',
			editSession: { previousContent: 'Answer in French.' },
		} );
	} );

	it( 'does not save while the content still matches what is stored', () => {
		render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Answer in French.' },
		} );
		act( () => void vi.advanceTimersByTime( 800 ) );

		expect( save ).not.toHaveBeenCalled();
	} );

	// The autosave means the stored value already matches by the time the user leaves, so the
	// boundary has to carry the value the visit started from.
	it( 'reports the edit session on unmount after the debounce already saved', () => {
		const { unmount } = render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Answer in Spanish.' },
		} );
		act( () => void vi.advanceTimersByTime( 800 ) );
		expect( save ).toHaveBeenCalledExactlyOnceWith( { content: 'Answer in Spanish.' } );

		unmount();

		expect( save ).toHaveBeenLastCalledWith( {
			content: 'Answer in Spanish.',
			editSession: { previousContent: 'Answer in French.' },
		} );
	} );

	it( 'does not report an edit session when the user only looked at the tab', () => {
		const { unmount } = render( <StudioCodePanel /> );

		unmount();

		expect( save ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a save failure', () => {
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: true } as never );

		render( <StudioCodePanel /> );

		expect(
			screen.getByText( 'Saving the instructions failed. Please try again.' )
		).toBeInTheDocument();
	} );
} );
