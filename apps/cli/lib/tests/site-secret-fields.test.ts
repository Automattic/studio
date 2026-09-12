import { omitSiteSecretFields, SITE_SECRET_FIELD_KEYS } from '../site-secret-fields';

describe( 'omitSiteSecretFields', () => {
	it( 'drops known secret keys and keeps inventory fields', () => {
		const publicRecord = omitSiteSecretFields( {
			id: 'site-1',
			name: 'Test Site',
			path: '/path/to/site',
			port: 8881,
			phpVersion: '8.4',
			runtime: 'native-php',
			url: 'http://localhost:8881',
			running: true,
			adminUsername: 'admin',
			adminPassword: 'encoded-secret',
			tlsKey: 'private-key',
			tlsCert: 'certificate',
		} );

		expect( publicRecord ).toEqual( {
			id: 'site-1',
			name: 'Test Site',
			path: '/path/to/site',
			port: 8881,
			phpVersion: '8.4',
			runtime: 'native-php',
			url: 'http://localhost:8881',
			running: true,
			adminUsername: 'admin',
		} );
		for ( const key of SITE_SECRET_FIELD_KEYS ) {
			expect( publicRecord ).not.toHaveProperty( key );
		}
	} );
} );
