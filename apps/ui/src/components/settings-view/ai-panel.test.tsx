import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAiSettings, useSaveAnthropicApiKey } from '@/data/queries/use-ai-settings';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AiPanel } from './ai-panel';
import type { AiSettings } from '@studio/common/ai/providers';

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
		placeholder?: string;
		onChange: ( value: string ) => void;
	} ) => (
		<input
			type="password"
			aria-label={ props.label }
			placeholder={ props.placeholder }
			value={ props.value }
			onChange={ ( event ) => props.onChange( event.target.value ) }
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
			error: null,
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

	it( 'shows the global instructions editor when the host can reach the instructions file', () => {
		mockConnector();
		render( <AiPanel /> );

		expect( screen.getByTestId( 'studio-code-panel' ) ).toBeInTheDocument();
	} );

	it( 'hides the global instructions editor when the host cannot reach the instructions file', () => {
		mockConnector( false );
		render( <AiPanel /> );

		expect( screen.queryByTestId( 'studio-code-panel' ) ).not.toBeInTheDocument();
	} );

	it( 'hides the Anthropic API key section when the host has no AI settings access', () => {
		mockConnector( true, false );
		render( <AiPanel /> );

		expect( screen.queryByText( 'Use your Anthropic API key' ) ).not.toBeInTheDocument();
	} );

	it( 'saves the trimmed key after the user stops typing', async () => {
		vi.useFakeTimers();
		try {
			mockConnector( true, true );
			mockAiSettings( {
				provider: 'wpcom',
				hasAnthropicApiKey: false,
				anthropicApiKeyPreview: null,
			} );
			render( <AiPanel /> );

			fireEvent.change( screen.getByLabelText( 'Anthropic API key' ), {
				target: { value: '  sk-ant-test-1234  ' },
			} );
			expect( saveKey ).not.toHaveBeenCalled();

			act( () => {
				vi.advanceTimersByTime( 800 );
			} );

			expect( saveKey ).toHaveBeenCalledWith( 'sk-ant-test-1234' );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'clears the saved key when the field is emptied', async () => {
		vi.useFakeTimers();
		try {
			mockConnector( true, true );
			mockAiSettings( {
				provider: 'anthropic-api-key',
				hasAnthropicApiKey: true,
				anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
			} );
			render( <AiPanel /> );

			const input = screen.getByLabelText( 'Anthropic API key' );
			fireEvent.change( input, { target: { value: 'sk-ant-test-1234' } } );
			fireEvent.change( input, { target: { value: '' } } );
			act( () => {
				vi.advanceTimersByTime( 800 );
			} );

			expect( saveKey ).toHaveBeenCalledWith( null );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'leaves the provider choice to the conversation, not a toggle', () => {
		mockConnector( true, true );
		mockAiSettings( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		render( <AiPanel /> );

		expect( screen.getByLabelText( 'Anthropic API key' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'checkbox', { name: 'Use your Anthropic API key' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows why saving the key failed', () => {
		mockConnector( true, true );
		mockAiSettings( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		useSaveAnthropicApiKeyMock.mockReturnValue( {
			mutate: saveKey,
			isPending: false,
			error: new Error( 'Anthropic rejected this API key. Check the key and try again.' ),
		} as never );
		render( <AiPanel /> );

		expect(
			screen.getByText( 'Anthropic rejected this API key. Check the key and try again.' )
		).toBeInTheDocument();
		expect(
			screen.getByLabelText( 'Anthropic API key' ).closest( '[class*="apiKeyControlsError"]' )
		).not.toBeNull();
	} );
} );
