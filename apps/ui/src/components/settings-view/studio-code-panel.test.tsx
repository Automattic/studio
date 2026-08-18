import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
	useSetAgentInstructionsEnabled,
} from '@/data/queries/use-agent-instructions';
import { StudioCodePanel } from './studio-code-panel';

vi.mock( '@/data/queries/use-agent-instructions', () => ( {
	useAgentInstructions: vi.fn(),
	useSaveAgentInstructions: vi.fn(),
	useSetAgentInstructionsEnabled: vi.fn(),
} ) );

const useAgentInstructionsMock = vi.mocked( useAgentInstructions );
const useSaveAgentInstructionsMock = vi.mocked( useSaveAgentInstructions );
const useSetAgentInstructionsEnabledMock = vi.mocked( useSetAgentInstructionsEnabled );

// These assert the panel supplies `editSession`, not that an event was recorded.
describe( 'StudioCodePanel', () => {
	const save = vi.fn();
	const setEnabled = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		useAgentInstructionsMock.mockReturnValue( {
			data: { content: 'Answer in French.', enabled: true },
		} as never );
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: false } as never );
		useSetAgentInstructionsEnabledMock.mockReturnValue( {
			mutate: setEnabled,
			isError: false,
		} as never );
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

	it( 'starts disabled when no instructions are saved and reveals the editor when enabled', () => {
		useAgentInstructionsMock.mockReturnValue( { data: { content: '', enabled: false } } as never );

		const { rerender } = render( <StudioCodePanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Enable instructions' } );
		expect( toggle ).not.toBeChecked();
		expect( screen.queryByLabelText( 'Instructions' ) ).not.toBeInTheDocument();

		fireEvent.click( toggle );
		expect( setEnabled ).toHaveBeenCalledWith( true );

		useAgentInstructionsMock.mockReturnValue( { data: { content: '', enabled: true } } as never );
		rerender( <StudioCodePanel /> );
		expect( toggle ).toBeChecked();
		expect( screen.getByLabelText( 'Instructions' ) ).toBeInTheDocument();
	} );

	it( 'preserves saved instructions when disabled and restores them when enabled again', () => {
		const { rerender } = render( <StudioCodePanel /> );

		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enable instructions' } ) );
		expect( setEnabled ).toHaveBeenCalledWith( false );
		expect( save ).not.toHaveBeenCalled();

		useAgentInstructionsMock.mockReturnValue( {
			data: { content: 'Answer in French.', enabled: false },
		} as never );
		rerender( <StudioCodePanel /> );
		expect( screen.queryByLabelText( 'Instructions' ) ).not.toBeInTheDocument();

		useAgentInstructionsMock.mockReturnValue( {
			data: { content: 'Answer in French.', enabled: true },
		} as never );
		rerender( <StudioCodePanel /> );
		expect( screen.getByLabelText( 'Instructions' ) ).toHaveValue( 'Answer in French.' );
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

	// The cleanup must key off unmount, not the mutate callback's identity, or a re-render would end
	// the edit session early and the real unmount would report the same edit a second time.
	it( 'reports the edit session once even if the mutate callback changes identity', () => {
		const { rerender, unmount } = render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Answer in Spanish.' },
		} );

		useSaveAgentInstructionsMock.mockReturnValue( {
			mutate: ( ...args: unknown[] ) => save( ...args ),
			isError: false,
		} as never );
		rerender( <StudioCodePanel /> );

		expect( save.mock.calls.filter( ( [ arg ] ) => arg.editSession ) ).toHaveLength( 0 );

		unmount();

		expect( save.mock.calls.filter( ( [ arg ] ) => arg.editSession ) ).toHaveLength( 1 );
	} );

	it( 'surfaces a save failure', () => {
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: true } as never );

		render( <StudioCodePanel /> );

		expect(
			screen.getByText( 'Saving the instructions failed. Please try again.' )
		).toBeInTheDocument();
	} );

	it( 'surfaces an enabled-state failure', () => {
		useSetAgentInstructionsEnabledMock.mockReturnValue( {
			mutate: setEnabled,
			isError: true,
		} as never );

		render( <StudioCodePanel /> );

		expect(
			screen.getByText( 'Updating the instructions setting failed. Please try again.' )
		).toBeInTheDocument();
	} );
} );
