import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useAgentInstructions,
	useSaveAgentInstructions,
} from '@/data/queries/use-agent-instructions';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { StudioCodePanel } from './studio-code-panel';

vi.mock( '@wordpress/components', () => ( {
	FormToggle: ( props: {
		checked: boolean;
		disabled?: boolean;
		'aria-label'?: string;
		onChange: () => void;
	} ) => (
		<input
			type="checkbox"
			aria-label={ props[ 'aria-label' ] }
			checked={ props.checked }
			disabled={ props.disabled }
			onChange={ props.onChange }
		/>
	),
} ) );

vi.mock( '@/data/queries/use-agent-instructions', () => ( {
	useAgentInstructions: vi.fn(),
	useSaveAgentInstructions: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

const useAgentInstructionsMock = vi.mocked( useAgentInstructions );
const useSaveAgentInstructionsMock = vi.mocked( useSaveAgentInstructions );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );

describe( 'StudioCodePanel', () => {
	const save = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		useAgentInstructionsMock.mockReturnValue( { data: 'Answer in French.' } as never );
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: false } as never );
		useAgenticFeaturesMock.mockReturnValue( { reason: null } as never );
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
		expect( save ).toHaveBeenCalledWith( 'Answer in Spanish.' );
	} );

	it( 'flushes a pending edit when the panel unmounts mid-debounce', () => {
		const { unmount } = render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Half-typed thought' },
		} );
		unmount();

		expect( save ).toHaveBeenCalledExactlyOnceWith( 'Half-typed thought' );
	} );

	it( 'does not save while the content still matches what is stored', () => {
		render( <StudioCodePanel /> );

		fireEvent.change( screen.getByLabelText( 'Instructions' ), {
			target: { value: 'Answer in French.' },
		} );
		act( () => void vi.advanceTimersByTime( 800 ) );

		expect( save ).not.toHaveBeenCalled();
	} );

	it( 'surfaces a save failure', () => {
		useSaveAgentInstructionsMock.mockReturnValue( { mutate: save, isError: true } as never );

		render( <StudioCodePanel /> );

		expect(
			screen.getByText( 'Saving the instructions failed. Please try again.' )
		).toBeInTheDocument();
	} );

	it( 'keeps the editor hidden until the switch is enabled', () => {
		useAgentInstructionsMock.mockReturnValue( { data: '' } as never );

		render( <StudioCodePanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Enable instructions' } );
		expect( toggle ).not.toBeChecked();
		expect( screen.queryByLabelText( 'Instructions' ) ).not.toBeInTheDocument();

		fireEvent.click( toggle );

		expect( screen.getByLabelText( 'Instructions' ) ).toBeInTheDocument();
	} );

	it( 'clears the saved instructions when the switch is turned off', () => {
		render( <StudioCodePanel /> );

		// Existing instructions default the switch on, so the first click turns it off.
		fireEvent.click( screen.getByRole( 'checkbox', { name: 'Enable instructions' } ) );

		expect( screen.queryByLabelText( 'Instructions' ) ).not.toBeInTheDocument();

		act( () => void vi.advanceTimersByTime( 800 ) );

		expect( save ).toHaveBeenCalledWith( '' );
	} );

	it( 'locks the editor and prompts sign-in when signed out', () => {
		useAgenticFeaturesMock.mockReturnValue( { reason: 'signed-out' } as never );

		render( <StudioCodePanel /> );

		expect( screen.getByText( 'You must log in for agent instructions.' ) ).toBeInTheDocument();
		expect( screen.getByRole( 'checkbox', { name: 'Enable instructions' } ) ).toBeDisabled();
		expect( screen.queryByLabelText( 'Instructions' ) ).not.toBeInTheDocument();
	} );
} );
