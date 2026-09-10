import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogin } from '@/data/queries/use-auth-user';
import { useSaveUserPreferences } from '@/data/queries/use-user-preferences';
import { AgenticSigninPrompt } from './index';

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useLogin: vi.fn(),
} ) );

// The annotation slide inverts its mock site against the app color scheme,
// which reads through the connector.
vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

describe( 'AgenticSigninPrompt', () => {
	const login = vi.fn();
	const savePreferences = vi.fn(
		( _partial, options?: { onSuccess?: () => void } ) => options?.onSuccess?.()
	);

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( useLogin, { partial: true } ).mockReturnValue( {
			isPending: false,
			mutate: login,
		} );
		vi.mocked( useSaveUserPreferences, { partial: true } ).mockReturnValue( {
			isPending: false,
			mutate: savePreferences as never,
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
		expect( screen.getByRole( 'tab', { name: 'Annotate', selected: true } ) ).toBeVisible();
		expect( screen.getByText( /Point at anything in the site preview/ ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'tab', { name: 'Sync' } ) );
		expect( screen.getByRole( 'tab', { name: 'Sync', selected: true } ) ).toBeVisible();
		expect( screen.getByText( /Sync content, plugins, themes, and files/ ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Previous feature' } ) );
		expect( screen.getByRole( 'tab', { name: 'Annotate', selected: true } ) ).toBeVisible();
		expect( useLogin ).toHaveBeenCalledWith( { source: 'assistant_tab' } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( login ).toHaveBeenCalledOnce();
	} );

	// The deck auto-advances and loops, so the pause has to be reachable
	// without a mouse (WCAG 2.2.2) — not just a click on the decorative stage.
	it( 'exposes pausing the demo as a control', () => {
		render( <AgenticSigninPrompt /> );

		const pause = screen.getByRole( 'button', { name: 'Pause the demo' } );
		expect( pause ).toHaveAttribute( 'aria-pressed', 'false' );

		fireEvent.click( pause );

		const resume = screen.getByRole( 'button', { name: 'Resume the demo' } );
		expect( resume ).toHaveAttribute( 'aria-pressed', 'true' );

		fireEvent.click( resume );

		expect( screen.getByRole( 'button', { name: 'Pause the demo' } ) ).toBeVisible();
	} );

	it( 'turns agentic features off before switching to the overview', () => {
		const onOpenOverview = vi.fn();
		render( <AgenticSigninPrompt onOpenOverview={ onOpenOverview } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Switch to Overview' } ) );
		expect( screen.getByRole( 'dialog', { name: 'Turn off Studio Code?' } ) ).toBeVisible();
		expect( onOpenOverview ).not.toHaveBeenCalled();

		fireEvent.click( screen.getByRole( 'button', { name: 'Turn off and switch' } ) );

		expect( savePreferences ).toHaveBeenCalledWith(
			{ agenticFeaturesEnabled: false },
			expect.anything()
		);
		expect( onOpenOverview ).toHaveBeenCalledOnce();
	} );

	it( 'keeps the slide and pause state across a remount (switching sites)', () => {
		const first = render( <AgenticSigninPrompt /> );
		fireEvent.click( screen.getByRole( 'tab', { name: 'Annotate' } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Pause the demo' } ) );
		first.unmount();

		render( <AgenticSigninPrompt /> );

		expect( screen.getByRole( 'tab', { name: 'Annotate', selected: true } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Resume the demo' } ) ).toBeVisible();
	} );
} );
