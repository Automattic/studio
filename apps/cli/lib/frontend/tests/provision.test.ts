import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger } from 'cli/logger';
import { provisionHeadlessBackend } from '../provision';
import type { SiteFrontend } from '@studio/common/lib/site-frontend';
import type { SiteData } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/run-wp-cli-command' );

type WpCliReply = { exitCode?: number; stdout?: string; stderr?: string };

function reply( { exitCode = 0, stdout = '', stderr = '' }: WpCliReply = {} ) {
	return {
		response: {
			exitCode: Promise.resolve( exitCode ),
			stdoutText: Promise.resolve( stdout ),
			stderrText: Promise.resolve( stderr ),
		},
		[ Symbol.dispose ]: vi.fn(),
	} as never;
}

// Answers each WP-CLI call by its leading arguments.
function mockWpCli( replies: Record< string, WpCliReply > ) {
	vi.mocked( runWpCliCommand ).mockImplementation( async ( _site, args ) => {
		const key = Object.keys( replies ).find( ( prefix ) => args.join( ' ' ).startsWith( prefix ) );
		return reply( key ? replies[ key ] : {} );
	} );
}

function calledArgs(): string[] {
	return vi.mocked( runWpCliCommand ).mock.calls.map( ( [ , args ] ) => args.join( ' ' ) );
}

describe( 'provisionHeadlessBackend', () => {
	let frontendPath: string;
	let site: SiteData & { frontend: SiteFrontend };
	const logger = new Logger< string >();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.spyOn( logger, 'reportStart' ).mockImplementation( () => {} );
		vi.spyOn( logger, 'reportSuccess' ).mockImplementation( () => {} );
		vi.spyOn( logger, 'reportWarning' ).mockImplementation( () => {} );
		frontendPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-frontend-' ) );
		site = {
			id: 'site-id',
			name: 'Headless',
			path: '/sites/headless/wordpress',
			port: 8881,
			phpVersion: '8.3',
			frontend: {
				path: frontendPath,
				kind: 'command',
				framework: 'next',
				port: 3000,
				api: 'rest',
				previewSecret: 'preview-secret',
				revalidateSecret: 'revalidate-secret',
			},
		};
	} );

	afterEach( () => {
		fs.rmSync( frontendPath, { recursive: true, force: true } );
	} );

	it( 'creates the frontend user and writes the env contract', async () => {
		mockWpCli( {
			'user get': { exitCode: 1, stderr: 'Error: Invalid user ID, email or login' },
			'user application-password create': { stdout: 'abcd efgh ijkl mnop\n' },
		} );

		await provisionHeadlessBackend( site, logger );

		const calls = calledArgs();
		expect( calls[ 0 ] ).toBe( 'rewrite structure /%postname%/' );
		expect( calls ).toContainEqual(
			expect.stringMatching(
				/^user create studio-frontend studio-frontend@example.com --role=editor --user_pass=\S+ --porcelain$/
			)
		);
		expect( calls ).toContain(
			'user application-password create studio-frontend Studio frontend --porcelain'
		);
		expect( calls.some( ( call ) => call.startsWith( 'plugin install' ) ) ).toBe( false );

		const env = fs.readFileSync( path.join( frontendPath, '.env.local' ), 'utf8' );
		expect( env ).toContain( 'WORDPRESS_URL="http://localhost:8881"' );
		expect( env ).toContain( 'WORDPRESS_APPLICATION_USER="studio-frontend"' );
		expect( env ).toContain( 'WORDPRESS_APPLICATION_PASSWORD="abcd efgh ijkl mnop"' );
		expect( env ).toContain( 'STUDIO_PREVIEW_SECRET="preview-secret"' );
		expect( env ).toContain( 'STUDIO_REVALIDATE_SECRET="revalidate-secret"' );
		expect( env ).toContain( 'PORT="3000"' );
		expect( env ).not.toContain( 'WORDPRESS_GRAPHQL_URL' );
	} );

	it( 'reuses an existing frontend user', async () => {
		mockWpCli( {
			'user get': { stdout: '2\n' },
			'user application-password create': { stdout: 'new password' },
		} );

		await provisionHeadlessBackend( site, logger );

		expect( calledArgs().some( ( call ) => call.startsWith( 'user create' ) ) ).toBe( false );
		expect( fs.readFileSync( path.join( frontendPath, '.env.local' ), 'utf8' ) ).toContain(
			'WORDPRESS_APPLICATION_PASSWORD="new password"'
		);
	} );

	it( 'installs WPGraphQL for a GraphQL frontend and carries on when it fails', async () => {
		site.frontend.api = 'graphql';
		mockWpCli( {
			'user get': { stdout: '2' },
			'user application-password create': { stdout: 'password' },
			'plugin install': { exitCode: 1, stderr: 'Could not resolve host' },
		} );

		await provisionHeadlessBackend( site, logger );

		expect( calledArgs() ).toContain( 'plugin install wp-graphql --activate' );
		expect( logger.reportWarning ).toHaveBeenCalled();
		expect( fs.readFileSync( path.join( frontendPath, '.env.local' ), 'utf8' ) ).toContain(
			'WORDPRESS_GRAPHQL_URL="http://localhost:8881/graphql"'
		);
	} );

	it( 'fails when WordPress cannot create the application password', async () => {
		mockWpCli( {
			'user get': { stdout: '2' },
			'user application-password create': { exitCode: 1, stderr: 'Error' },
		} );

		await expect( provisionHeadlessBackend( site, logger ) ).rejects.toThrow(
			'Failed to create the frontend application password'
		);
		expect( fs.existsSync( path.join( frontendPath, '.env.local' ) ) ).toBe( false );
	} );
} );
