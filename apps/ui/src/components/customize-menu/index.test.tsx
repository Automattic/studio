import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useIsSiteStarting, useIsSiteStopping, useStartSite } from '@/data/queries/use-sites';
import { CustomizeMenu } from './index';
import type { SiteDetails } from '@/data/core';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', async () => {
	const { cloneElement } = await import( 'react' );
	return {
		Button: ( {
			children,
			tone,
			variant,
			size,
			...props
		}: ButtonHTMLAttributes< HTMLButtonElement > & {
			children?: ReactNode;
			tone?: string;
			variant?: string;
			size?: string;
		} ) => {
			void tone;
			void variant;
			void size;
			return <button { ...props }>{ children }</button>;
		},
		Tooltip: {
			Root: ( { children }: { children: ReactNode } ) => <>{ children }</>,
			Trigger: ( {
				render: renderProp,
				children,
			}: {
				render: React.ReactElement< { children?: ReactNode } >;
				children?: ReactNode;
			} ) => cloneElement( renderProp, {}, children ),
			Positioner: () => null,
			Popup: () => null,
		},
	};
} );

vi.mock( '@/components/menu', () => ( {
	Root: ( { children }: { children: ReactNode } ) => <div>{ children }</div>,
	Trigger: ( { render: renderProp }: { render: ReactNode } ) => <>{ renderProp }</>,
	Popup: ( { children }: { children: ReactNode } ) => <div role="menu">{ children }</div>,
	Item: ( {
		children,
		onClick,
		disabled,
	}: {
		children: ReactNode;
		onClick?: () => void;
		disabled?: boolean;
	} ) => (
		<button type="button" onClick={ onClick } disabled={ disabled }>
			{ children }
		</button>
	),
	Separator: () => <hr />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useIsSiteStarting: vi.fn(),
	useIsSiteStopping: vi.fn(),
	useStartSite: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector, { partial: true } );
const useIsSiteStartingMock = vi.mocked( useIsSiteStarting );
const useIsSiteStoppingMock = vi.mocked( useIsSiteStopping );
const useStartSiteMock = vi.mocked( useStartSite, { partial: true } );

describe( 'CustomizeMenu', () => {
	const openSiteUrl = vi.fn().mockResolvedValue( undefined );
	const startSite = vi.fn().mockResolvedValue( undefined );

	beforeEach( () => {
		vi.clearAllMocks();
		window.localStorage.clear();
		useConnectorMock.mockReturnValue( { openSiteUrl } );
		useIsSiteStartingMock.mockReturnValue( false );
		useIsSiteStoppingMock.mockReturnValue( false );
		useStartSiteMock.mockReturnValue( {
			isPending: false,
			mutate: startSite,
			mutateAsync: startSite,
		} );
	} );

	it( 'shows site editor links for block themes and routes them to wp-admin', async () => {
		render( <CustomizeMenu site={ createSite( { running: true } ) } /> );

		expect( screen.getByText( 'Site Editor' ) ).toBeVisible();
		expect( screen.getByText( 'Styles' ) ).toBeVisible();
		expect( screen.queryByText( 'Customizer' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Site Editor' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Posts' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'Pages' ).closest( 'button' )! );
		fireEvent.click( screen.getByText( 'WP Admin' ).closest( 'button' )! );

		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/site-editor.php' )
		);
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php' );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php?post_type=page' );
		expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/' );
		expect( startSite ).not.toHaveBeenCalled();
	} );

	it( 'shows the customizer instead of the site editor for classic themes', () => {
		render(
			<CustomizeMenu
				site={ createSite( {
					running: true,
					themeDetails: {
						name: 'Twenty Twenty-One',
						path: '/wp-content/themes/twentytwentyone',
						slug: 'twentytwentyone',
						isBlockTheme: false,
						supportsMenus: true,
						supportsWidgets: false,
					},
				} ) }
			/>
		);

		expect( screen.getByText( 'Customizer' ) ).toBeVisible();
		expect( screen.getByText( 'Menus' ) ).toBeVisible();
		expect( screen.queryByText( 'Widgets' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Site Editor' ) ).not.toBeInTheDocument();
	} );

	it( 'runs the last used link from the split action button', async () => {
		render( <CustomizeMenu site={ createSite( { running: true } ) } /> );

		// Defaults to the theme's main editing surface.
		fireEvent.click( screen.getByRole( 'button', { name: 'Open Site Editor' } ) );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/site-editor.php' )
		);

		fireEvent.click( screen.getByText( 'Posts' ).closest( 'button' )! );
		fireEvent.click( screen.getByRole( 'button', { name: 'Open Posts' } ) );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php' )
		);
		expect( window.localStorage.getItem( 'studio:customize-menu:last-used' ) ).toBe( 'posts' );
	} );

	it( 'starts a stopped site before opening a link', async () => {
		render( <CustomizeMenu site={ createSite( { running: false } ) } /> );

		fireEvent.click( screen.getByText( 'Posts' ).closest( 'button' )! );

		await waitFor( () => expect( startSite ).toHaveBeenCalledWith( 'site-1' ) );
		await waitFor( () =>
			expect( openSiteUrl ).toHaveBeenCalledWith( 'site-1', '/wp-admin/edit.php' )
		);
	} );
} );

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Demo Site',
		path: '/Users/example/Studio/demo-site',
		port: 8881,
		running: false,
		phpVersion: '8.4',
		adminUsername: 'admin',
		adminEmail: 'admin@example.com',
		enableDebugLog: true,
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: '/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
		},
		...overrides,
	};
}
