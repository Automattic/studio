import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AiPanel } from './ai-panel';

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

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
	useSaveUserPreferences: vi.fn(),
} ) );

vi.mock( './studio-code-panel', () => ( {
	StudioCodePanel: () => <div data-testid="studio-code-panel" />,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );

describe( 'AiPanel', () => {
	const disableAgenticUi = vi.fn( () => Promise.resolve() );
	const mutate = vi.fn();

	function mockConnector( agentInstructions = true ) {
		useConnectorMock.mockReturnValue( {
			capabilities: { agentInstructions },
			disableAgenticUi,
		} as never );
	}

	function mockPreferences( agenticFeaturesEnabled: boolean, isLoading = false ) {
		useUserPreferencesMock.mockReturnValue( {
			data: { agenticFeaturesEnabled },
			isLoading,
		} as never );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		useSaveUserPreferencesMock.mockReturnValue( { mutate } as never );
		mockPreferences( true );
	} );

	it( 'turns agentic features off without leaving the new UI', () => {
		mockConnector();
		render( <AiPanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Agentic features' } );
		expect( toggle ).toBeChecked();

		fireEvent.click( toggle );

		expect( mutate ).toHaveBeenCalledWith( { agenticFeaturesEnabled: false } );
		expect( disableAgenticUi ).not.toHaveBeenCalled();
	} );

	it( 'turns agentic features back on', () => {
		mockConnector();
		mockPreferences( false );
		render( <AiPanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Agentic features' } );
		expect( toggle ).not.toBeChecked();

		fireEvent.click( toggle );

		expect( mutate ).toHaveBeenCalledWith( { agenticFeaturesEnabled: true } );
	} );

	it( 'shows the toggle even when the host cannot switch back to the classic UI', () => {
		mockConnector();
		render( <AiPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Agentic features' } ) ).toBeInTheDocument();
	} );

	it( 'shows the global instructions editor alongside the agentic features toggle', () => {
		mockConnector();
		render( <AiPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Agentic features' } ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'studio-code-panel' ) ).toBeInTheDocument();
	} );

	it( 'hides the global instructions editor when the host cannot reach the instructions file', () => {
		mockConnector( false );
		render( <AiPanel /> );

		expect( screen.queryByTestId( 'studio-code-panel' ) ).not.toBeInTheDocument();
	} );
} );
