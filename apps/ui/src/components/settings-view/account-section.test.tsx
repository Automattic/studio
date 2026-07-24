import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useUserLocale } from '@/data/queries/use-user-locale';
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

vi.mock( '@/data/queries/use-user-locale', () => ( {
	useUserLocale: vi.fn(),
} ) );

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( './usage-panel', () => ( {
	AiCreditsSection: () => <div data-testid="ai-credits-section" />,
	PreviewUsageSection: () => <div data-testid="preview-usage-section" />,
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useUserLocaleMock = vi.mocked( useUserLocale );

describe( 'AccountSection', () => {
	const loginMutate = vi.fn();
	const logoutMutate = vi.fn();
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useConnectorMock.mockReturnValue( { openExternalUrl } as never );
		useUserLocaleMock.mockReturnValue( undefined );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, displayName: 'Ada Lovelace', email: 'ada@example.com' },
			isLoading: false,
		} as never );
		useLoginMock.mockReturnValue( { mutate: loginMutate, isPending: false } as never );
		useLogoutMock.mockReturnValue( { mutate: logoutMutate, isPending: false } as never );
	} );

	it( 'shows the signed-in user and logs out on request', () => {
		render( <AccountSection /> );

		expect( screen.getByText( 'Ada Lovelace' ) ).toBeInTheDocument();
		expect( screen.getByText( 'ada@example.com' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'gravatar' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Log in' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log out' } ) );

		expect( logoutMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows preview-site usage only for a signed-in user', () => {
		const { rerender } = render( <AccountSection /> );
		expect( screen.getByTestId( 'preview-usage-section' ) ).toBeInTheDocument();

		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );
		rerender( <AccountSection /> );
		expect( screen.queryByTestId( 'preview-usage-section' ) ).not.toBeInTheDocument();
	} );

	it( 'prompts signed-out users with the overview sign-in pitch', () => {
		useAuthUserMock.mockReturnValue( { data: null, isLoading: false } as never );

		render( <AccountSection /> );

		expect(
			screen.getByRole( 'heading', { name: 'Let Studio code it for you' } )
		).toBeInTheDocument();
		expect( screen.getByText( /An AI powered WordPress expert/ ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'gravatar' ) ).not.toBeInTheDocument();
		expect( screen.queryByTestId( 'ai-credits-section' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Log out' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Log in with WordPress.com' } ) );

		expect( loginMutate ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'opens docs and issue links through the connector', () => {
		render( <AccountSection /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Documentation' } ) );

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

		fireEvent.click( screen.getByRole( 'button', { name: 'Documentation' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			'https://developer.wordpress.com/es/docs/herramientas-para-desarrolladores/studio/'
		);
	} );
} );
