import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SessionUIProvider, useSessionPreviewUI } from './use-session-ui';
import type { Connector } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@/data/core') >();
	return {
		...actual,
		useConnector: vi.fn(),
	};
} );

vi.mocked( useConnector ).mockReturnValue( {
	onToggleSitePreview: vi.fn( () => vi.fn() ),
} as unknown as Connector );

function wrapper( { children }: { children: ReactNode } ) {
	return <SessionUIProvider>{ children }</SessionUIProvider>;
}

describe( 'useSessionPreviewUI site switching', () => {
	it( 'opens the preview on the review surface and returns to the site', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setOpen( false ) );
		act( () => result.current.showReview() );
		expect( result.current.open ).toBe( true );
		expect( result.current.surface ).toBe( 'review' );

		act( () => result.current.showSite() );
		expect( result.current.surface ).toBe( 'site' );
	} );

	it( 'opens a never-previewed site at home instead of the previous site path', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/about' ) );
		expect( result.current.path ).toBe( '/about' );

		act( () => result.current.setSite( 'site-b' ) );
		expect( result.current.path ).toBe( '/' );
		expect( result.current.siteId ).toBe( 'site-b' );
	} );

	it( 'restores each site last visited path when switching back', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/about' ) );
		act( () => result.current.setSite( 'site-b' ) );
		act( () => result.current.updatePath( '/blog' ) );

		act( () => result.current.setSite( 'site-a' ) );
		expect( result.current.path ).toBe( '/about' );

		act( () => result.current.setSite( 'site-b' ) );
		expect( result.current.path ).toBe( '/blog' );
	} );

	it( 'keeps the path when the previewed site is unchanged', () => {
		const { result } = renderHook( () => useSessionPreviewUI(), { wrapper } );

		act( () => result.current.setSite( 'site-a' ) );
		act( () => result.current.updatePath( '/contact' ) );

		act( () => result.current.setSite( 'site-a' ) );
		expect( result.current.path ).toBe( '/contact' );
	} );
} );
