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

const useConnectorMock = vi.mocked( useConnector );

describe( 'AiPanel', () => {
	const disableAgenticUi = vi.fn( () => Promise.resolve() );

	function mockConnector( switchToClassicUi: boolean ) {
		useConnectorMock.mockReturnValue( {
			capabilities: { switchToClassicUi },
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
} );
