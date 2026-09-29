import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import {
	useSpacefastLogin,
	useSpacefastLogout,
	useSpacefastSignedIn,
	useSpacefastTeams,
} from '@/data/queries/use-spacefast';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { useOffline } from '@/hooks/use-offline';
import { AccountSection } from './account-section';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		loading,
		loadingAnnouncement,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		children?: ReactNode;
		loading?: boolean;
		loadingAnnouncement?: string;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void tone;
		void variant;
		void size;
		return <button { ...props }>{ loading ? loadingAnnouncement : children }</button>;
	},
	Tooltip: {
		Root: ( { children }: { children?: ReactNode } ) => <>{ children }</>,
		Trigger: ( { render }: { render?: ReactNode } ) => <>{ render }</>,
		Popup: () => null,
		Positioner: () => null,
	},
} ) );

vi.mock( '@/components/gravatar', () => ( {
	Gravatar: () => <span data-testid="gravatar" />,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-spacefast', () => ( {
	useSpacefastSignedIn: vi.fn(),
	useSpacefastTeams: vi.fn(),
	useSpacefastLogin: vi.fn(),
	useSpacefastLogout: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@/hooks/use-offline', () => ( {
	useOffline: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useUserLocaleMock = vi.mocked( useUserLocale );
const useOfflineMock = vi.mocked( useOffline );

// The account row whose title is `title`: its closest ancestor holding a button.
function getRow( title: string ): HTMLElement {
	let element = screen.getByRole( 'heading', { name: title } ).parentElement!;
	while ( ! element.querySelector( 'button' ) ) {
		element = element.parentElement!;
	}
	return element;
}

describe( 'AccountSection', () => {
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();
	const openExternalUrl = vi.fn();
	const spacefastLoginMutate = vi.fn();
	const spacefastLogoutMutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useConnectorMock.mockReturnValue( { openExternalUrl } as never );
		useUserLocaleMock.mockReturnValue( undefined );
		useOfflineMock.mockReturnValue( false );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
			isLoading: false,
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
		vi.mocked( useSpacefastSignedIn ).mockReturnValue( { data: false, isLoading: false } as never );
		vi.mocked( useSpacefastTeams ).mockReturnValue( { data: undefined } as never );
		vi.mocked( useSpacefastLogin ).mockReturnValue( {
			mutate: spacefastLoginMutate,
			isPending: false,
		} as never );
		vi.mocked( useSpacefastLogout ).mockReturnValue( {
			mutate: spacefastLogoutMutate,
			isPending: false,
		} as never );
	} );

	it( 'logs in to Spacefast when logged out', () => {
		render( <AccountSection /> );

		const row = getRow( 'Spacefast' );
		expect(
			within( row ).getByText( 'Log in to publish static copies of your sites.' )
		).toBeInTheDocument();
		fireEvent.click( within( row ).getByRole( 'button', { name: 'Log in' } ) );

		expect( spacefastLoginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows the Spacefast teams and logs out on request', () => {
		vi.mocked( useSpacefastSignedIn ).mockReturnValue( { data: true, isLoading: false } as never );
		vi.mocked( useSpacefastTeams ).mockReturnValue( {
			data: [ { id: 'team_1', name: "Ada's Team" } ],
		} as never );

		render( <AccountSection /> );

		const row = getRow( 'Spacefast' );
		expect( within( row ).getByText( "Ada's Team" ) ).toBeInTheDocument();
		fireEvent.click( within( row ).getByRole( 'button', { name: 'Log out' } ) );

		expect( spacefastLogoutMutate ).toHaveBeenCalledTimes( 1 );
		expect( logoutMutate ).not.toHaveBeenCalled();
	} );

	it( 'shows the signed-in user and logs out on request', () => {
		render( <AccountSection /> );

		const row = getRow( 'Ada Lovelace' );
		expect( within( row ).getByText( 'ada@example.com' ) ).toBeInTheDocument();
		expect( within( row ).getByTestId( 'gravatar' ) ).toBeInTheDocument();
		expect( within( row ).queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();

		fireEvent.click( within( row ).getByRole( 'button', { name: 'Log out' } ) );

		expect( logoutMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'prompts signed-out users to log in', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <AccountSection /> );

		const row = getRow( 'WordPress.com' );
		expect(
			within( row ).getByText(
				'Log in to use AI features and synchronize with live and preview sites.'
			)
		).toBeInTheDocument();
		expect( within( row ).queryByTestId( 'gravatar' ) ).not.toBeInTheDocument();
		expect( within( row ).queryByRole( 'button', { name: 'Log out' } ) ).not.toBeInTheDocument();

		fireEvent.click( within( row ).getByRole( 'button', { name: 'Log in' } ) );

		expect( loginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'disables the login button when offline', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );
		useOfflineMock.mockReturnValue( true );

		render( <AccountSection /> );

		for ( const button of screen.getAllByRole( 'button', { name: 'Log in' } ) ) {
			expect( button ).toBeDisabled();
		}
	} );

	it( 'opens docs and issue links through the connector', () => {
		render( <AccountSection /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Docs' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/docs/developer-tools/studio/'
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Report an issue' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://github.com/Automattic/studio/issues/new/choose'
		);
	} );

	it( 'opens localized docs when the locale has a translation', () => {
		useUserLocaleMock.mockReturnValue( 'es' );

		render( <AccountSection /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Docs' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/'
		);
	} );
} );
