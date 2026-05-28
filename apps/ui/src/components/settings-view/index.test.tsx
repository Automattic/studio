import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useInstalledApps } from '@/data/queries/use-installed-apps';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { SettingsView } from './index';
import type { ReactNode } from 'react';

const mocks = vi.hoisted( () => ( {
	setStudioUiMode: vi.fn(),
	mutate: vi.fn(),
} ) );

vi.mock( '@wordpress/dataviews', () => ( {
	DataForm: () => <div data-testid="data-form" />,
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		disabled,
		loading,
		onClick,
		type = 'button',
	}: {
		children?: ReactNode;
		disabled?: boolean;
		loading?: boolean;
		onClick?: () => void;
		type?: 'button' | 'submit';
	} ) => (
		<button type={ type } disabled={ disabled || loading } onClick={ onClick }>
			{ children }
		</button>
	),
} ) );

vi.mock( '@/components/tabs', () => ( {
	Root: ( { children }: { children?: ReactNode } ) => <div>{ children }</div>,
	List: ( { children }: { children?: ReactNode } ) => <div>{ children }</div>,
	Tab: ( { children }: { children?: ReactNode } ) => <button type="button">{ children }</button>,
	Panel: ( { children }: { children?: ReactNode } ) => <div>{ children }</div>,
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-installed-apps', () => ( {
	useInstalledApps: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

vi.mock( '@/hooks/use-fullscreen', () => ( {
	useFullscreen: vi.fn(),
} ) );

vi.mock( '@/hooks/use-sidebar-collapsed', () => ( {
	useSidebarCollapsed: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useInstalledAppsMock = vi.mocked( useInstalledApps );
const useUserPreferencesMock = vi.mocked( useUserPreferences );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useFullscreenMock = vi.mocked( useFullscreen );
const useSidebarCollapsedMock = vi.mocked( useSidebarCollapsed );

describe( 'SettingsView', () => {
	beforeEach( () => {
		mocks.setStudioUiMode.mockReset().mockResolvedValue( undefined );
		mocks.mutate.mockReset();

		useConnectorMock.mockReturnValue( {
			setStudioUiMode: mocks.setStudioUiMode,
		} as unknown as ReturnType< typeof useConnector > );
		useInstalledAppsMock.mockReturnValue( { data: undefined } as ReturnType<
			typeof useInstalledApps
		> );
		useUserPreferencesMock.mockReturnValue( {
			data: {
				editor: null,
				terminal: null,
				colorScheme: 'system',
				locale: 'en',
			},
			isLoading: false,
		} as ReturnType< typeof useUserPreferences > );
		useSaveUserPreferencesMock.mockReturnValue( {
			isPending: false,
			mutate: mocks.mutate,
		} as unknown as ReturnType< typeof useSaveUserPreferences > );
		useFullscreenMock.mockReturnValue( false );
		useSidebarCollapsedMock.mockReturnValue( false );
	} );

	it( 'switches back to the default Studio UI from preferences', () => {
		render( <SettingsView activeTab="preferences" onTabChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Switch to Default Studio UI' } ) );

		expect( mocks.setStudioUiMode ).toHaveBeenCalledWith( 'default' );
	} );
} );
