import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STUDIO_SITES_ROOT as mockSitesRoot } from 'cli/lib/site-paths';
import { getLspServerForSiteRoot, shutdownAllLspServers } from '../pool';

vi.mock( 'cli/lib/site-paths', async () => {
	const { mkdtempSync } = await import( 'fs' );
	const { tmpdir } = await import( 'os' );
	const { join } = await import( 'path' );
	return { STUDIO_SITES_ROOT: mkdtempSync( join( tmpdir(), 'studio-lsp-int-' ) ) };
} );

// The real wp-lsp server, downloaded into `wp-files/` by postinstall, driven
// over stdio exactly as the agent drives it. Requires a PHP CLI on PATH.
const repoWpLspRoot = path.resolve(
	path.dirname( fileURLToPath( import.meta.url ) ),
	'../../../../..',
	'wp-files',
	'wp-lsp'
);
const wpLspInstalled = fs.existsSync( path.join( repoWpLspRoot, 'bin', 'wp-lsp' ) );
const phpAvailable = spawnSync( 'php', [ '--version' ], { stdio: 'ignore' } ).status === 0;

const PLUGIN_CONTENT = `<?php
/**
 * Plugin Name: Fixture
 */
add_action( 'init', 'fixture_setup' );
add_action( 'ini', 'fixture_typo' );

function fixture_setup() {}
function fixture_typo() {}
`;

describe.skipIf( ! wpLspInstalled || ! phpAvailable )( 'wp-lsp integration', () => {
	const siteRoot = path.join( mockSitesRoot, 'fixture-site' );
	const pluginFile = path.join( siteRoot, 'wp-content', 'plugins', 'fixture', 'fixture.php' );
	const savedEnv: Record< string, string | undefined > = {};

	beforeAll( () => {
		for ( const key of [ 'STUDIO_WP_LSP_PATH', 'STUDIO_WP_LSP_PHP', 'DEV_CONFIG_DIR' ] ) {
			savedEnv[ key ] = process.env[ key ];
		}
		process.env.STUDIO_WP_LSP_PATH = repoWpLspRoot;
		process.env.STUDIO_WP_LSP_PHP = 'php';
		process.env.DEV_CONFIG_DIR = path.join( mockSitesRoot, 'config' );
		fs.mkdirSync( path.dirname( pluginFile ), { recursive: true } );
		fs.writeFileSync( pluginFile, PLUGIN_CONTENT );
	} );

	afterAll( async () => {
		await shutdownAllLspServers();
		for ( const [ key, value ] of Object.entries( savedEnv ) ) {
			if ( value === undefined ) {
				delete process.env[ key ];
			} else {
				process.env[ key ] = value;
			}
		}
		fs.rmSync( mockSitesRoot, { recursive: true, force: true } );
	} );

	it(
		'starts, reports the unknown hook, and resolves a string callback',
		{ timeout: 120_000 },
		async () => {
			const server = await getLspServerForSiteRoot( siteRoot );
			expect( server ).not.toBeNull();

			const uri = server!.client.syncDocument( pluginFile, PLUGIN_CONTENT );
			const diagnostics = await server!.client.waitForDiagnostics( uri, 30_000 );
			expect( diagnostics.some( ( diagnostic ) => diagnostic.message.includes( "'ini'" ) ) ).toBe(
				true
			);

			// Definition on the 'fixture_setup' string callback goes to the function.
			const lines = PLUGIN_CONTENT.split( '\n' );
			const callbackLine = lines.findIndex( ( line ) => line.includes( "'fixture_setup'" ) );
			const callbackColumn = lines[ callbackLine ].indexOf( 'fixture_setup' );
			const definition = await server!.client.request<
				| Array< { uri?: string; targetUri?: string; range?: { start: { line: number } } } >
				| {
						uri: string;
						range: { start: { line: number } };
				  }
				| null
			>(
				'textDocument/definition',
				{
					textDocument: { uri },
					position: { line: callbackLine, character: callbackColumn },
				},
				30_000
			);
			const first = Array.isArray( definition ) ? definition[ 0 ] : definition;
			expect( first ).toBeTruthy();
			const functionLine = lines.findIndex( ( line ) => line.includes( 'function fixture_setup' ) );
			const resolvedLine =
				( first as { range?: { start: { line: number } } } ).range?.start.line ??
				( first as { targetRange?: { start: { line: number } } } ).targetRange?.start.line;
			expect( resolvedLine ).toBe( functionLine );
		}
	);
} );
