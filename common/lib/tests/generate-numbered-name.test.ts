import { generateNumberedName } from '../generate-numbered-name';

describe( 'generateNumberedName', () => {
	it( 'should return base name when it is available', async () => {
		const isAvailable = vi.fn().mockResolvedValue( true );

		const result = await generateNumberedName( 'My Site', isAvailable );

		expect( result ).toBe( 'My Site' );
		expect( isAvailable ).toHaveBeenCalledTimes( 1 );
		expect( isAvailable ).toHaveBeenCalledWith( 'My Site' );
	} );

	it( 'should return numbered name when base name is taken', async () => {
		const isAvailable = vi.fn().mockImplementation( ( name: string ) => {
			return Promise.resolve( name !== 'My Site' );
		} );

		const result = await generateNumberedName( 'My Site', isAvailable );

		expect( result ).toBe( 'My Site 2' );
		expect( isAvailable ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'should increment number until available name is found', async () => {
		const takenNames = new Set( [ 'My Site', 'My Site 2', 'My Site 3' ] );
		const isAvailable = vi.fn().mockImplementation( ( name: string ) => {
			return Promise.resolve( ! takenNames.has( name ) );
		} );

		const result = await generateNumberedName( 'My Site', isAvailable );

		expect( result ).toBe( 'My Site 4' );
		expect( isAvailable ).toHaveBeenCalledTimes( 4 );
	} );

	it( 'should handle names with existing numbers', async () => {
		const takenNames = new Set( [ 'Site 1' ] );
		const isAvailable = vi.fn().mockImplementation( ( name: string ) => {
			return Promise.resolve( ! takenNames.has( name ) );
		} );

		const result = await generateNumberedName( 'Site 1', isAvailable );

		expect( result ).toBe( 'Site 1 2' );
	} );

	it( 'should handle empty base name', async () => {
		const isAvailable = vi.fn().mockResolvedValue( false ).mockResolvedValueOnce( false );
		isAvailable.mockImplementation( ( name: string ) => {
			return Promise.resolve( name === ' 2' );
		} );

		const result = await generateNumberedName( '', isAvailable );

		expect( result ).toBe( ' 2' );
	} );

	it( 'should handle many iterations', async () => {
		const takenCount = 99;
		const takenNames = new Set< string >();
		takenNames.add( 'Site' );
		for ( let i = 2; i <= takenCount; i++ ) {
			takenNames.add( `Site ${ i }` );
		}

		const isAvailable = vi.fn().mockImplementation( ( name: string ) => {
			return Promise.resolve( ! takenNames.has( name ) );
		} );

		const result = await generateNumberedName( 'Site', isAvailable );

		expect( result ).toBe( 'Site 100' );
	} );

	it( 'should await each isAvailable call', async () => {
		const callOrder: string[] = [];
		const isAvailable = vi.fn().mockImplementation( async ( name: string ) => {
			callOrder.push( `start:${ name }` );
			await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
			callOrder.push( `end:${ name }` );
			return name === 'Site 2';
		} );

		await generateNumberedName( 'Site', isAvailable );

		expect( callOrder ).toEqual( [ 'start:Site', 'end:Site', 'start:Site 2', 'end:Site 2' ] );
	} );
} );
