import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
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

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( './account-section', () => ( {
	AccountSection: () => <div data-testid="account-section" />,
} ) );

vi.mock( './studio-code-panel', () => ( {
	StudioCodePanel: () => <div data-testid="studio-code-panel" />,
} ) );

vi.mock( './skills-panel', () => ( {
	SkillsPanel: () => <div data-testid="skills-panel" />,
} ) );

vi.mock( '@/components/offline-banner', () => ( {
	OfflineNotice: () => <div role="status">You&apos;re offline</div>,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );

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
		useAgenticFeaturesMock.mockReturnValue( { reason: null } as never );
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

	it( 'hides the toggle but keeps the card when the host cannot switch UIs', () => {
		mockConnector( false );
		render( <AiPanel /> );

		expect( screen.queryByRole( 'checkbox' ) ).not.toBeInTheDocument();
		expect( disableAgenticUi ).not.toHaveBeenCalled();
		// The card still renders its heading, just without the toggle.
		expect( screen.getByRole( 'heading', { name: 'Agentic features' } ) ).toBeInTheDocument();
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

	it( 'shows no sign-in banner when signed out — the pitch lives in the account sidebar', () => {
		mockConnector( true );
		useAgenticFeaturesMock.mockReturnValue( { reason: 'signed-out' } as never );
		render( <AiPanel /> );

		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'disables the agentic features toggle when signed out', () => {
		mockConnector( true );
		useAgenticFeaturesMock.mockReturnValue( { reason: 'signed-out' } as never );
		render( <AiPanel /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Agentic features' } );
		expect( toggle ).toBeDisabled();
		expect( toggle ).not.toBeChecked();
	} );

	it( 'shows the offline notice when offline', () => {
		mockConnector( true );
		useAgenticFeaturesMock.mockReturnValue( { reason: 'offline' } as never );
		render( <AiPanel /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( "You're offline" );
		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
	} );

	it( 'shows neither banner when signed in and online', () => {
		mockConnector( true );
		render( <AiPanel /> );

		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );
} );
