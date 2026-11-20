import { getLocaleData, getLocaleDataAsync, isSupportedLocale, supportedLocales } from '../locale';

describe( 'asynchronous locale data', () => {
	it.each( supportedLocales )( 'loads the existing catalog for %s', async ( locale ) => {
		expect( await getLocaleDataAsync( locale ) ).toEqual( getLocaleData( locale ) );
	} );

	it.each( [ 'mi-NZ', 'constructor', '__proto__', '../studio-ar' ] )(
		'returns null for unsupported locale %s',
		async ( locale ) => {
			expect( isSupportedLocale( locale ) ).toBe( false );
			expect( await getLocaleDataAsync( locale ) ).toBeNull();
		}
	);
} );
