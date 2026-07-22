import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { StudioCliSection } from './studio-cli-section';

vi.mock( '@/components/learn-more', () => ( {
	LearnMoreLink: () => null,
} ) );

vi.mock( '@/data/queries/use-app-globals', () => ( {
	useAppGlobals: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-user-preferences', () => ( {
	useSaveUserPreferences: vi.fn(),
	useUserPreferences: vi.fn(),
} ) );

const useAppGlobalsMock = vi.mocked( useAppGlobals );
const useSaveUserPreferencesMock = vi.mocked( useSaveUserPreferences );
const useUserPreferencesMock = vi.mocked( useUserPreferences );

describe( 'StudioCliSection', () => {
	const mutate = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();

		useAppGlobalsMock.mockReturnValue( {
			data: { platform: 'darwin', isWindowsStore: false },
		} as never );
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate,
			isPending: false,
			isError: false,
		} as never );
		useUserPreferencesMock.mockReturnValue( {
			data: { studioCliInstalled: false, studioCliExternallyManaged: false },
		} as never );
	} );

	it( 'saves as soon as the toggle is flipped', () => {
		render( <StudioCliSection /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Studio CLI for terminal' } );
		expect( toggle ).not.toBeChecked();

		fireEvent.click( toggle );

		expect( mutate ).toHaveBeenCalledWith( { studioCliInstalled: true }, expect.any( Object ) );
		expect( toggle ).toBeChecked();
	} );

	it( 'reverts the toggle to the saved state when the install fails', () => {
		mutate.mockImplementation( ( _patch, options ) => options?.onSettled?.() );

		render( <StudioCliSection /> );

		const toggle = screen.getByRole( 'checkbox', { name: 'Studio CLI for terminal' } );
		fireEvent.click( toggle );

		expect( toggle ).not.toBeChecked();
	} );

	it( 'surfaces an install/uninstall error inline', () => {
		useSaveUserPreferencesMock.mockReturnValue( {
			mutate,
			isPending: false,
			isError: true,
		} as never );

		render( <StudioCliSection /> );

		expect(
			screen.getByText( 'An error occurred while updating the Studio CLI. Please try again.' )
		).toBeInTheDocument();
	} );

	it( 'disables the toggle for a standalone (externally managed) CLI', () => {
		useUserPreferencesMock.mockReturnValue( {
			data: { studioCliInstalled: true, studioCliExternallyManaged: true },
		} as never );

		render(
			<Tooltip.Provider>
				<StudioCliSection />
			</Tooltip.Provider>
		);

		const toggle = screen.getByRole( 'checkbox', { name: 'Studio CLI for terminal' } );
		expect( toggle ).toBeChecked();
		expect( toggle ).toBeDisabled();

		fireEvent.click( toggle );

		expect( mutate ).not.toHaveBeenCalled();
	} );

	it( 'is hidden in the browser', () => {
		useAppGlobalsMock.mockReturnValue( {
			data: { platform: 'browser', isWindowsStore: false },
		} as never );

		const { container } = render( <StudioCliSection /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'is hidden in Windows Store builds', () => {
		useAppGlobalsMock.mockReturnValue( {
			data: { platform: 'win32', isWindowsStore: true },
		} as never );

		const { container } = render( <StudioCliSection /> );

		expect( container ).toBeEmptyDOMElement();
	} );
} );
