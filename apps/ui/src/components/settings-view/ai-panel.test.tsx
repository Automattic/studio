import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
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

vi.mock( './studio-code-panel', () => ( {
	StudioCodePanel: () => <div data-testid="studio-code-panel" />,
} ) );

const useConnectorMock = vi.mocked( useConnector );

describe( 'AiPanel', () => {
	const disableAgenticUi = vi.fn( () => Promise.resolve() );

	function mockConnector( switchToClassicUi: boolean, agentInstructions = true ) {
		useConnectorMock.mockReturnValue( {
			capabilities: { switchToClassicUi, agentInstructions },
			disableAgenticUi,
		} as never );
	}

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'switches back to the classic UI when agentic features are toggled off', () => {
		mockConnector( true );
		render( <AiPanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Agentic features' } );
		expect( toggle ).toBeChecked();

		fireEvent.click( toggle );

		expect( disableAgenticUi ).toHaveBeenCalled();
		expect( toggle ).not.toBeChecked();
		expect( toggle ).toBeDisabled();
	} );

	it( 'hides the agentic features section when the host cannot switch UIs', () => {
		mockConnector( false );
		render( <AiPanel /> );

		expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		expect( disableAgenticUi ).not.toHaveBeenCalled();
	} );

	it( 'shows the global instructions editor alongside the agentic features toggle', () => {
		mockConnector( true );
		render( <AiPanel /> );

		expect( screen.getByRole( 'checkbox', { name: 'Agentic features' } ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'studio-code-panel' ) ).toBeInTheDocument();
	} );

	it( 'hides the global instructions editor when the host cannot reach the instructions file', () => {
		mockConnector( true, false );
		render( <AiPanel /> );

		expect( screen.queryByTestId( 'studio-code-panel' ) ).not.toBeInTheDocument();
	} );
} );
