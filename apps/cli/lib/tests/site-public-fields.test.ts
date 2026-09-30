import { pickPublicSiteFields } from '../site-public-fields';

describe( 'pickPublicSiteFields', () => {
	it( 'keeps listed inventory fields and drops everything else', () => {
		const publicRecord = pickPublicSiteFields( {
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
			latestCliPid: 1234,
			someFutureSecret: 'new-secret',
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
	} );
} );
