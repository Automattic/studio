import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAiSettings, useSaveAnthropicApiKey } from '@/data/queries/use-ai-settings';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AiPanel } from './ai-panel';
import type { AiSettings } from '@studio/common/ai/providers';
import type { ReactNode } from 'react';

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
	TextControl: ( props: {
		value: string;
		label?: string;
		disabled?: boolean;
		onChange: ( value: string ) => void;
	} ) => (
		<input
			type="password"
			aria-label={ props.label }
			value={ props.value }
			disabled={ props.disabled }
			onChange={ ( event ) => props.onChange( event.target.value ) }
		/>
	),
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: ( props: { children: ReactNode; disabled?: boolean; onClick?: () => void } ) => (
		<button disabled={ props.disabled } onClick={ props.onClick }>
			{ props.children }
		</button>
	),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
	useSaveUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-ai-settings', () => ( {
	useAiSettings: vi.fn(),
	useSaveAnthropicApiKey: vi.fn(),
} ) );

vi.mock( './studio-code-panel', () => ( {
	StudioCodePanel: () => <div data-testid="studio-code-panel" />,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useAiSettingsMock = vi.mocked( useAiSettings );
const useSaveAnthropicApiKeyMock = vi.mocked( useSaveAnthropicApiKey );

describe( 'AiPanel', () => {
	const disableAgenticUi = vi.fn( () => Promise.resolve() );
	const mutate = vi.fn();
	const saveKey = vi.fn();

	function mockConnector( agentInstructions = true, aiSettings = false ) {
		useConnectorMock.mockReturnValue( {
			capabilities: { agentInstructions, aiSettings },
			disableAgenticUi,
		} as never );
	}

	function mockPreferences( agenticFeaturesEnabled: boolean, isLoading = false ) {
		useUserPreferencesMock.mockReturnValue( {
			data: { agenticFeaturesEnabled },
			isLoading,
		} as never );
	}

	function mockAiSettings( settings: AiSettings | undefined ) {
		useAiSettingsMock.mockReturnValue( { data: settings } as never );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		useSaveUserPreferencesMock.mockReturnValue( { mutate } as never );
		useSaveAnthropicApiKeyMock.mockReturnValue( {
			mutate: saveKey,
			isPending: false,
			isError: false,
		} as never );
		mockAiSettings( undefined );
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

	it( 'hides the Anthropic API key form when the host has no AI settings access', () => {
		mockConnector( true, false );
		render( <AiPanel /> );

		expect( screen.queryByText( 'Anthropic API key' ) ).not.toBeInTheDocument();
	} );

	it( 'saves a trimmed Anthropic API key', () => {
		mockConnector( true, true );
		mockAiSettings( { provider: 'wpcom', hasAnthropicApiKey: false, anthropicApiKeySuffix: null } );
		render( <AiPanel /> );

		const input = screen.getByLabelText( 'Anthropic API key' );
		const save = screen.getByRole( 'button', { name: 'Save' } );
		expect( save ).toBeDisabled();

		fireEvent.change( input, { target: { value: '  sk-ant-test-1234  ' } } );
		expect( save ).toBeEnabled();
		fireEvent.click( save );

		expect( saveKey ).toHaveBeenCalledWith( 'sk-ant-test-1234', expect.anything() );
	} );

	it( 'shows the validation message when saving the key fails', () => {
		mockConnector( true, true );
		mockAiSettings( { provider: 'wpcom', hasAnthropicApiKey: false, anthropicApiKeySuffix: null } );
		useSaveAnthropicApiKeyMock.mockReturnValue( {
			mutate: saveKey,
			isPending: false,
			isError: true,
			error: new Error( 'Anthropic rejected this API key. Check the key and try again.' ),
		} as never );
		render( <AiPanel /> );

		expect(
			screen.getByText( 'Anthropic rejected this API key. Check the key and try again.' )
		).toBeInTheDocument();
	} );

	it( 'removes the saved key to fall back to WordPress.com', () => {
		mockConnector( true, true );
		mockAiSettings( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeySuffix: '1234',
		} );
		render( <AiPanel /> );

		expect( screen.getByText( /ending in 1234/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Save' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Remove key' } ) );

		expect( saveKey ).toHaveBeenCalledWith( null );
	} );
} );
