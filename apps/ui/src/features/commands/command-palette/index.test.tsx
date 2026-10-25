import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import { useProvideCollapseAll } from '@/features/sidebar';
import { AlertDialog, DialogContent, DialogTitle } from '@/lib/ui';
import { CommandPalette } from './index';

const { savePreferences, openWhatsNew } = vi.hoisted( () => ( {
	savePreferences: vi.fn(),
	openWhatsNew: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => vi.fn() } ) );
vi.mock( '@/data/queries/use-sites', () => ( { useSites: () => ( { data: [] } ) } ) );
vi.mock( '@/data/queries/use-sessions', () => ( { useSessions: () => ( { data: [] } ) } ) );
vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: () => ( { isSuccess: true, data: { id: 1 } } ),
} ) );
vi.mock( '@/data/queries/use-agentic-features', () => ( {
	useAgenticFeatures: () => ( { chatEnabled: true } ),
} ) );
vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: () => ( { data: { analyticsEnabled: true } } ),
	useSaveUserPreferences: () => ( { mutate: savePreferences } ),
} ) );
vi.mock( '@/data/queries/use-sidebar-pins', () => ( {
	useSidebarPreferences: () => ( { showRecentChats: true, autoCollapseSites: false } ),
} ) );
vi.mock( '@/data/host/use-color-scheme', () => ( { useColorScheme: () => 'light' } ) );
vi.mock( '@/data/use-open-settings', () => ( { useOpenSettings: () => vi.fn() } ) );
vi.mock( '@/features/sites/use-open-add-site', () => ( { useOpenAddSite: () => vi.fn() } ) );
vi.mock( '@/data/use-open-site', () => ( { useOpenSite: () => vi.fn() } ) );
vi.mock( '@/features/onboarding/onboarding-guide/use-whats-new-replay', () => ( {
	useOpenWhatsNew: () => openWhatsNew,
} ) );

function Sidebar( { foldable }: { foldable: boolean } ) {
	useProvideCollapseAll( foldable ? collapseAll : undefined );
	return null;
}
const collapseAll = vi.fn();

describe( 'CommandPalette', () => {
	afterEach( () => act( () => setCommandPaletteOpen( false ) ) );

	const pressK = ( target: Element = document.body ) =>
		fireEvent.keyDown( target, { key: 'л', code: 'KeyK', ctrlKey: true } );
	const search = ( query: string ) =>
		fireEvent.change( screen.getByRole( 'combobox', { name: 'Search commands' } ), {
			target: { value: query },
		} );

	it( 'opens on the K key whatever the layout types there, but not over a dialog', async () => {
		const { rerender } = render(
			<>
				<CommandPalette />
				<AlertDialog open>
					<DialogContent>
						<DialogTitle>Confirm</DialogTitle>
					</DialogContent>
				</AlertDialog>
			</>
		);
		pressK();
		expect( screen.queryByRole( 'dialog', { name: 'Command palette' } ) ).not.toBeInTheDocument();

		rerender( <CommandPalette /> );
		pressK();
		expect( await screen.findByRole( 'dialog', { name: 'Command palette' } ) ).toBeInTheDocument();
	} );

	it( 'turns a setting on or off in place while searching', async () => {
		render( <CommandPalette /> );
		pressK();
		expect( await screen.findByRole( 'dialog' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Turn off “Show recent chats”' ) ).not.toBeInTheDocument();

		search( 'recent chats' );
		fireEvent.click( await screen.findByText( 'Turn off “Show recent chats”' ) );
		expect( savePreferences ).toHaveBeenCalledWith( { showRecentChats: false } );

		pressK();
		search( 'improve studio' );
		fireEvent.click(
			await screen.findByText( 'Turn off “Improve WordPress Studio for everyone”' )
		);
		expect( savePreferences ).toHaveBeenLastCalledWith( {
			analyticsEnabled: false,
			source: { surface: 'settings' },
		} );
	} );

	it( 'resets the appearance tint', async () => {
		render( <CommandPalette /> );
		pressK();
		search( 'reset appearance' );
		fireEvent.click( await screen.findByText( 'Reset appearance tint' ) );

		expect( savePreferences ).toHaveBeenCalledWith( {
			accentColor: '#3858e9',
			tintIntensity: 0,
			contrast: 0,
		} );
	} );

	it( 'replays What’s New, which the browser app has no menu for', async () => {
		render( <CommandPalette /> );
		pressK();
		search( 'new features' );
		fireEvent.click( await screen.findByText( 'What’s New' ) );
		expect( openWhatsNew ).toHaveBeenCalled();
	} );

	it( 'offers Collapse all while the sidebar has more than one site unfolded', async () => {
		const { rerender } = render(
			<>
				<CommandPalette />
				<Sidebar foldable={ false } />
			</>
		);
		pressK();
		search( 'collapse' );
		expect( await screen.findByText( 'Turn on “Collapse sidebar groups”' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Collapse all' ) ).not.toBeInTheDocument();

		rerender(
			<>
				<CommandPalette />
				<Sidebar foldable />
			</>
		);
		fireEvent.click( await screen.findByText( 'Collapse all' ) );
		expect( collapseAll ).toHaveBeenCalled();
	} );
} );
