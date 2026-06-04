import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useAuthUser, useLogin, useLogout } from '@/data/queries/use-auth-user';
import { useSites } from '@/data/queries/use-sites';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { DeskMenu } from './index';

const routerMock = vi.hoisted( () => ( {
	navigate: vi.fn(),
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => routerMock.navigate,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-auth-user', () => ( {
	useAuthUser: vi.fn(),
	useLogin: vi.fn(),
	useLogout: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-sites', () => ( {
	useSites: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-prefers-color-scheme', () => ( {
	usePrefersColorScheme: () => 'light',
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useAuthUserMock = vi.mocked( useAuthUser );
const useLoginMock = vi.mocked( useLogin );
const useLogoutMock = vi.mocked( useLogout );
const useSitesMock = vi.mocked( useSites );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'DeskMenu', () => {
	beforeEach( () => {
		routerMock.navigate.mockReset();
		useConnectorMock.mockReturnValue( {
			openExternalUrl: vi.fn(),
		} as never );
		useAuthUserMock.mockReturnValue( {
			data: { id: 1, email: 'person@example.com', displayName: 'Person' },
		} as never );
		useLoginMock.mockReturnValue( {
			isPending: false,
			mutate: vi.fn(),
		} as never );
		useLogoutMock.mockReturnValue( {
			mutate: vi.fn(),
		} as never );
		useSitesMock.mockReturnValue( {
			data: [],
			isLoading: false,
		} as never );
		useUserPreferencesMock.mockReturnValue( {
			data: { colorScheme: 'light' },
		} as never );
	} );

	it( 'does not expose the Studio 1.0 switch from the menu', async () => {
		render( <DeskMenu /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Desk menu' } ) );

		expect(
			await screen.findByRole( 'menuitem', { name: 'person@example.com' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'menuitem', { name: 'Switch to Studio 1.0' } )
		).not.toBeInTheDocument();
	} );
} );
