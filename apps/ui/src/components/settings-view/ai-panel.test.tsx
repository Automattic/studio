import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
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

vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
	useSaveUserPreferences: vi.fn(),
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

vi.mock( '@/components/agentic-signin-banner', () => ( {
	SigninNotice: () => <div aria-label="Sign in to Studio" />,
} ) );

vi.mock( '@/components/offline-banner', () => ( {
	OfflineNotice: () => <div role="status">You&apos;re offline</div>,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAgenticFeaturesMock = vi.mocked( useAgenticFeatures );
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
		useAgenticFeaturesMock.mockReturnValue( { reason: null } as never );
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

	it( 'shows no sign-in banner when signed out — the pitch lives in the account sidebar', () => {
		mockConnector();
		useAgenticFeaturesMock.mockReturnValue( { reason: 'signed-out' } as never );
		render( <AiPanel /> );

		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the offline notice when offline', () => {
		mockConnector();
		useAgenticFeaturesMock.mockReturnValue( { reason: 'offline' } as never );
		render( <AiPanel /> );

		expect( screen.getByRole( 'status' ) ).toHaveTextContent( "You're offline" );
		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
	} );

	it( 'shows neither banner when signed in and online', () => {
		mockConnector();
		render( <AiPanel /> );

		expect( screen.queryByLabelText( 'Sign in to Studio' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'status' ) ).not.toBeInTheDocument();
	} );
} );
