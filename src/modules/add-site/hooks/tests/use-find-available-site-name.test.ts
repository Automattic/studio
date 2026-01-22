import { renderHook } from '@testing-library/react';
import { vi, beforeEach, describe, it, expect } from 'vitest';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useFindAvailableSiteName } from '../use-find-available-site-name';

vi.mock( 'src/lib/get-ipc-api' );

const mockGenerateProposedSitePath =
	vi.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();

describe( 'useFindAvailableSiteName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			generateProposedSitePath: mockGenerateProposedSitePath,
		} );
	} );

	it( 'should return the base name if it is available', async () => {
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'My Site',
			isEmpty: true,
			isWordPress: false,
		} );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 1 );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledWith( 'My Site' );
	} );

	it( 'should return "baseName 2" if base name is not available', async () => {
		mockGenerateProposedSitePath
			.mockResolvedValueOnce( {
				path: '/path/to/site',
				name: 'My Site',
				isEmpty: false,
				isWordPress: false,
			} )
			.mockResolvedValueOnce( {
				path: '/path/to/site-2',
				name: 'My Site 2',
				isEmpty: true,
				isWordPress: false,
			} );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site 2' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 2 );
		expect( mockGenerateProposedSitePath ).toHaveBeenNthCalledWith( 1, 'My Site' );
		expect( mockGenerateProposedSitePath ).toHaveBeenNthCalledWith( 2, 'My Site 2' );
	} );

	it( 'should return "baseName 3" if base name and "baseName 2" are not available', async () => {
		mockGenerateProposedSitePath
			.mockResolvedValueOnce( {
				path: '/path/to/site',
				name: 'My Site',
				isEmpty: false,
				isWordPress: false,
			} )
			.mockResolvedValueOnce( {
				path: '/path/to/site-2',
				name: 'My Site 2',
				isEmpty: false,
				isWordPress: false,
			} )
			.mockResolvedValueOnce( {
				path: '/path/to/site-3',
				name: 'My Site 3',
				isEmpty: true,
				isWordPress: false,
			} );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site 3' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 3 );
		expect( mockGenerateProposedSitePath ).toHaveBeenNthCalledWith( 1, 'My Site' );
		expect( mockGenerateProposedSitePath ).toHaveBeenNthCalledWith( 2, 'My Site 2' );
		expect( mockGenerateProposedSitePath ).toHaveBeenNthCalledWith( 3, 'My Site 3' );
	} );

	it( 'should continue iterating until finding an available name', async () => {
		const mockCalls = [];
		for ( let i = 1; i <= 5; i++ ) {
			mockCalls.push( {
				path: `/path/to/site-${ i }`,
				name: i === 1 ? 'My Site' : `My Site ${ i }`,
				isEmpty: i === 5,
				isWordPress: false,
			} );
		}

		mockGenerateProposedSitePath
			.mockResolvedValueOnce( mockCalls[ 0 ] )
			.mockResolvedValueOnce( mockCalls[ 1 ] )
			.mockResolvedValueOnce( mockCalls[ 2 ] )
			.mockResolvedValueOnce( mockCalls[ 3 ] )
			.mockResolvedValueOnce( mockCalls[ 4 ] );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site 5' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'should handle WordPress directories as not available', async () => {
		mockGenerateProposedSitePath
			.mockResolvedValueOnce( {
				path: '/path/to/site',
				name: 'My Site',
				isEmpty: false,
				isWordPress: true,
			} )
			.mockResolvedValueOnce( {
				path: '/path/to/site-2',
				name: 'My Site 2',
				isEmpty: true,
				isWordPress: false,
			} );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site 2' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should return "baseName 500" if all previous names are not available (max iterations)', async () => {
		mockGenerateProposedSitePath.mockImplementation( async ( name: string ) => {
			const match = name.match( /^My Site(?: (\d+))?$/ );
			if ( ! match ) {
				return {
					path: '/path/to/site',
					name,
					isEmpty: false,
					isWordPress: false,
				};
			}
			const num = match[ 1 ] ? parseInt( match[ 1 ], 10 ) : 1;
			if ( num < 500 ) {
				return {
					path: `/path/to/site-${ num }`,
					name: num === 1 ? 'My Site' : `My Site ${ num }`,
					isEmpty: false,
					isWordPress: false,
				};
			}
			return {
				path: '/path/to/site-500',
				name: 'My Site 500',
				isEmpty: true,
				isWordPress: false,
			};
		} );

		const { result } = renderHook( () => useFindAvailableSiteName() );

		const availableName = await result.current( 'My Site' );

		expect( availableName ).toBe( 'My Site 500' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 499 );
	} );

	it( 'should return a stable function reference across renders', () => {
		const { result, rerender } = renderHook( () => useFindAvailableSiteName() );

		const firstRender = result.current;
		rerender();
		const secondRender = result.current;

		expect( firstRender ).toBe( secondRender );
	} );
} );
