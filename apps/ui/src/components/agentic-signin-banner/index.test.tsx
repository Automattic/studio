import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogin } from '@/data/queries/use-auth-user';
import { AgenticSigninPrompt } from './index';

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useLogin: vi.fn(),
} ) );

// The annotation slide inverts its mock site against the app color scheme,
// which reads through the connector.
vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

describe( 'AgenticSigninPrompt', () => {
	const login = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useLogin, { partial: true } ).mockReturnValue( {
			isPending: false,
			mutate: login,
		} );
	} );

	it( 'walks through the signed-in features and starts login from the assistant', () => {
		render( <AgenticSigninPrompt /> );

		expect(
			screen.getByRole( 'heading', { name: 'Your personal WordPress expert' } )
		).toBeVisible();
		expect( screen.getByRole( 'tab', { name: 'Studio Code', selected: true } ) ).toBeVisible();
		expect( screen.getByText( /Chat to build themes, write plugins/ ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Next feature' } ) );
		expect( screen.getByRole( 'tab', { name: 'Annotations', selected: true } ) ).toBeVisible();
		expect( screen.getByText( /Point at anything in the site preview/ ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Sync' } ) );
		expect( screen.getByRole( 'tab', { name: 'Sync', selected: true } ) ).toBeVisible();
		expect( screen.getByText( /Sync content, plugins, themes, and files/ ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Previous feature' } ) );
		expect( screen.getByRole( 'tab', { name: 'Annotations', selected: true } ) ).toBeVisible();
		expect( useLogin ).toHaveBeenCalledWith( { source: 'assistant_tab' } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( login ).toHaveBeenCalledOnce();
	} );
} );
