import { vi } from 'vitest';
import { FolderDialogResponse } from 'src/ipc-handlers';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { generateNumberedName } from '../generate-site-name';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
} ) );

const mockGenerateProposedSitePath =
	vi.fn< ( siteName: string ) => Promise< FolderDialogResponse > >();

describe( 'generateNumberedName', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( {
			generateProposedSitePath: mockGenerateProposedSitePath,
		} );
	} );

	it( 'should return base name when it is available', async () => {
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'My Site',
			isEmpty: true,
			isWordPress: false,
		} );

		const result = await generateNumberedName( 'My Site', [] );

		expect( result ).toBe( 'My Site' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 1 );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledWith( 'My Site' );
	} );

	it( 'should return numbered name when base name is taken by existing site', async () => {
		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'My Site 2',
			isEmpty: true,
			isWordPress: false,
		} );
		const usedSites = [ { id: '1', name: 'My Site', path: '/path/1' } ] as SiteDetails[];

		const result = await generateNumberedName( 'My Site', usedSites );

		expect( result ).toBe( 'My Site 2' );
	} );

	it( 'should return numbered name when base name directory is not empty', async () => {
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

		const result = await generateNumberedName( 'My Site', [] );

		expect( result ).toBe( 'My Site 2' );
		expect( mockGenerateProposedSitePath ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should increment number until available name is found', async () => {
		const usedSites = [
			{ id: '1', name: 'My Site', path: '/path/1' },
			{ id: '2', name: 'My Site 2', path: '/path/2' },
			{ id: '3', name: 'My Site 3', path: '/path/3' },
		] as SiteDetails[];

		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'My Site 4',
			isEmpty: true,
			isWordPress: false,
		} );

		const result = await generateNumberedName( 'My Site', usedSites );

		expect( result ).toBe( 'My Site 4' );
	} );

	it( 'should handle names with existing numbers', async () => {
		const usedSites = [ { id: '1', name: 'Site 1', path: '/path/1' } ] as SiteDetails[];

		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'Site 1 2',
			isEmpty: true,
			isWordPress: false,
		} );

		const result = await generateNumberedName( 'Site 1', usedSites );

		expect( result ).toBe( 'Site 1 2' );
	} );

	it( 'should handle many iterations', async () => {
		const usedSites: SiteDetails[] = [];
		usedSites.push( { id: '0', name: 'Site', path: '/path/0' } as SiteDetails );
		for ( let i = 2; i <= 99; i++ ) {
			usedSites.push( {
				id: String( i ),
				name: `Site ${ i }`,
				path: `/path/${ i }`,
			} as SiteDetails );
		}

		mockGenerateProposedSitePath.mockResolvedValue( {
			path: '/path/to/site',
			name: 'Site 100',
			isEmpty: true,
			isWordPress: false,
		} );

		const result = await generateNumberedName( 'Site', usedSites );

		expect( result ).toBe( 'Site 100' );
	} );

	it( 'should check directory availability for each candidate name', async () => {
		const callOrder: string[] = [];
		mockGenerateProposedSitePath.mockImplementation( async ( name: string ) => {
			callOrder.push( `start:${ name }` );
			await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
			callOrder.push( `end:${ name }` );
			return {
				path: `/path/to/${ name }`,
				name,
				isEmpty: name === 'Site 2',
				isWordPress: false,
			};
		} );

		await generateNumberedName( 'Site', [] );

		expect( callOrder ).toEqual( [ 'start:Site', 'end:Site', 'start:Site 2', 'end:Site 2' ] );
	} );
} );
