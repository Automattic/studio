import path from 'path';
import {
	buildDevServerEnv,
	buildFrontendChildEnv,
	FRONTEND_CHILD_ENV,
	parseFrontendChildConfig,
} from 'cli/lib/frontend/child-config';

describe( 'frontend child config', () => {
	const contractEnv = { WORDPRESS_URL: 'http://localhost:8881', PORT: '4321' };

	it( 'round-trips a static frontend', () => {
		const env = buildFrontendChildEnv( {
			baseEnv: { HOME: '/Users/me' },
			frontend: { path: '/sites/demo/frontend', kind: 'static', servedDir: 'public', port: 4321 },
			contractEnv,
		} );

		expect( env.HOME ).toBe( '/Users/me' );
		expect( env.WORDPRESS_URL ).toBe( 'http://localhost:8881' );
		expect( parseFrontendChildConfig( env ) ).toEqual( {
			kind: 'static',
			port: 4321,
			projectPath: '/sites/demo/frontend',
			servedDir: path.resolve( '/sites/demo/frontend', 'public' ),
		} );
	} );

	it( 'serves the project folder itself when there is no servedDir', () => {
		const env = buildFrontendChildEnv( {
			baseEnv: {},
			frontend: { path: '/sites/demo/frontend', kind: 'static', port: 4321 },
			contractEnv,
		} );
		expect( env[ FRONTEND_CHILD_ENV.SERVED_DIR ] ).toBe( path.resolve( '/sites/demo/frontend' ) );
	} );

	it( 'resolves ${port} in a command frontend and records the node directory', () => {
		const env = buildFrontendChildEnv( {
			baseEnv: {},
			frontend: {
				path: '/sites/demo/frontend',
				kind: 'command',
				devCommand: 'npm run dev -- --port ${port}',
				port: 3000,
			},
			contractEnv,
			nodePath: '/opt/node/bin/node',
		} );

		expect( parseFrontendChildConfig( env ) ).toEqual( {
			kind: 'command',
			port: 3000,
			projectPath: '/sites/demo/frontend',
			command: 'npm run dev -- --port 3000',
			nodeBinDir: '/opt/node/bin',
		} );
	} );

	it( 'rejects an incomplete configuration', () => {
		expect( () => parseFrontendChildConfig( {} ) ).toThrow();
		expect( () =>
			parseFrontendChildConfig( {
				[ FRONTEND_CHILD_ENV.KIND ]: 'command',
				[ FRONTEND_CHILD_ENV.PORT ]: '3000',
				[ FRONTEND_CHILD_ENV.PATH ]: '/sites/demo/frontend',
			} )
		).toThrow();
	} );

	it( 'passes the env contract to the dev server without Studio internals', () => {
		const childEnv = buildFrontendChildEnv( {
			baseEnv: {
				PATH: '/usr/bin',
				NODE_ENV: 'production',
				ELECTRON_RUN_AS_NODE: '1',
				NODE_CHANNEL_FD: '3',
				USER_VAR: 'kept',
			},
			frontend: {
				path: '/sites/demo/frontend',
				kind: 'command',
				devCommand: 'astro dev --port ${port}',
				port: 4321,
			},
			contractEnv: { ...contractEnv, STUDIO_PREVIEW_SECRET: 'secret' },
			nodePath: '/opt/node/bin/node',
		} );
		const config = parseFrontendChildConfig( childEnv );
		if ( config.kind !== 'command' ) {
			throw new Error( 'expected a command config' );
		}

		const devEnv = buildDevServerEnv( childEnv, config, 'darwin' );

		expect( devEnv ).toMatchObject( {
			WORDPRESS_URL: 'http://localhost:8881',
			STUDIO_PREVIEW_SECRET: 'secret',
			USER_VAR: 'kept',
			PORT: '4321',
			PATH: '/opt/node/bin:/usr/bin',
		} );
		for ( const key of [
			...Object.values( FRONTEND_CHILD_ENV ),
			'NODE_ENV',
			'ELECTRON_RUN_AS_NODE',
			'NODE_CHANNEL_FD',
		] ) {
			expect( devEnv ).not.toHaveProperty( key );
		}
	} );
} );
