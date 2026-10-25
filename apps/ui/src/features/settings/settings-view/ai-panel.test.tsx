import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	useAiSettings,
	useSaveAnthropicApiKey,
	useSetAiProvider,
} from '@/data/queries/use-ai-settings';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { AiPanel } from './ai-panel';
import type { AiSettings } from '@studio/common/ai/providers';

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
	useSaveUserPreferences: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-ai-settings', () => ( {
	useAiSettings: vi.fn(),
	useSaveAnthropicApiKey: vi.fn(),
	useSetAiProvider: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
} ) );

vi.mock( '@/features/onboarding/learn-more', () => ( { LearnMoreLink: () => null } ) );
vi.mock( '@/lib/hooks/use-offline', () => ( { useOffline: () => false } ) );

const SIGNED_OUT = { provider: 'wpcom', hasAnthropicApiKey: false, anthropicApiKeyPreview: null };

describe( 'AiPanel', () => {
	const savePreferences = vi.fn();
	const saveKey = vi.fn();
	const setProvider = vi.fn();
	const signup = vi.fn();
	const onManageCredits = vi.fn();

	function mockAiSettings( settings: AiSettings ) {
		vi.mocked( useAiSettings ).mockReturnValue( { data: settings } as never );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useUserPreferences ).mockReturnValue( {
			data: { agenticFeaturesEnabled: true },
			isLoading: false,
		} as never );
		vi.mocked( useSaveUserPreferences ).mockReturnValue( { mutate: savePreferences } as never );
		vi.mocked( useSaveAnthropicApiKey ).mockReturnValue( {
			mutate: saveKey,
			mutateAsync: saveKey,
			isPending: false,
			error: null,
		} as never );
		vi.mocked( useSetAiProvider ).mockReturnValue( {
			mutate: setProvider,
			mutateAsync: setProvider,
			isPending: false,
			error: null,
		} as never );
		vi.mocked( useAuthUser ).mockReturnValue( { data: null } as never );
		vi.mocked( useLogin ).mockReturnValue( { mutate: signup, isPending: false } as never );
		mockAiSettings( SIGNED_OUT as AiSettings );
	} );

	it( 'turns Studio Code off', () => {
		render( <AiPanel onManageCredits={ onManageCredits } /> );

		fireEvent.click( screen.getByRole( 'switch', { name: 'Studio Code' } ) );

		expect( savePreferences ).toHaveBeenCalledWith( { agenticFeaturesEnabled: false } );
	} );

	it( 'connects an Anthropic key without a WordPress.com account and makes it the provider', async () => {
		render( <AiPanel onManageCredits={ onManageCredits } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Connect', expanded: false } ) );
		fireEvent.change( screen.getByLabelText( 'Anthropic API key' ), {
			target: { value: '  sk-ant-test-1234  ' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Save' } ) );

		await waitFor( () => expect( setProvider ).toHaveBeenCalledWith( 'anthropic-api-key' ) );
		expect( saveKey ).toHaveBeenCalledWith( 'sk-ant-test-1234' );
		expect( screen.queryByLabelText( 'Anthropic API key' ) ).not.toBeInTheDocument();
	} );

	it( 'removes a saved key', () => {
		mockAiSettings( {
			provider: 'anthropic-api-key',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		render( <AiPanel onManageCredits={ onManageCredits } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Manage' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Remove key' } ) );

		expect( saveKey ).toHaveBeenCalledWith( null, expect.anything() );
	} );

	it( 'shows why saving the key failed', () => {
		vi.mocked( useSaveAnthropicApiKey ).mockReturnValue( {
			mutate: saveKey,
			isPending: false,
			error: new Error( 'Anthropic rejected this API key. Check the key and try again.' ),
		} as never );
		render( <AiPanel onManageCredits={ onManageCredits } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Connect', expanded: false } ) );

		expect(
			screen.getByText( 'Anthropic rejected this API key. Check the key and try again.' )
		).toBeInTheDocument();
	} );

	it( 'connects WordPress.com through sign-up, then makes it the provider', () => {
		const { rerender } = render( <AiPanel onManageCredits={ onManageCredits } /> );

		fireEvent.click( screen.getAllByRole( 'button', { name: 'Connect' } )[ 0 ] );
		expect( vi.mocked( useLogin ) ).toHaveBeenCalledWith( { signup: true, source: 'settings' } );
		expect( signup ).toHaveBeenCalled();
		expect( setProvider ).not.toHaveBeenCalled();

		vi.mocked( useAuthUser ).mockReturnValue( { data: { id: 1 } } as never );
		rerender( <AiPanel onManageCredits={ onManageCredits } /> );

		expect( setProvider ).toHaveBeenCalledWith( 'wpcom' );
	} );

	it( 'manages WordPress.com credits once connected', () => {
		vi.mocked( useAuthUser ).mockReturnValue( { data: { id: 1 } } as never );
		render( <AiPanel onManageCredits={ onManageCredits } /> );

		expect( screen.getByText( 'Connected' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Manage' } ) );

		expect( onManageCredits ).toHaveBeenCalled();
	} );
} );
