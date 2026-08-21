import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { collectEditToolDiagnostics, collectPhpFileDiagnostics, isPhpFile } from '../diagnostics';
import {
	getLspServerForSiteRoot,
	getSiteRootForFile,
	isWpLspAvailable,
	type LspServer,
} from '../pool';
import type { LspDiagnostic } from '../protocol';

vi.mock( '../pool', () => ( {
	isWpLspAvailable: vi.fn(),
	getSiteRootForFile: vi.fn(),
	getLspServerForSiteRoot: vi.fn(),
} ) );

const mockedAvailability = vi.mocked( isWpLspAvailable );
const mockedSiteRoot = vi.mocked( getSiteRootForFile );
const mockedGetServer = vi.mocked( getLspServerForSiteRoot );

function fakeServer( diagnostics: LspDiagnostic[] ): LspServer {
	return {
		siteRoot: '/site',
		lastUsedAt: 0,
		warmedUp: true,
		client: {
			syncDocument: vi.fn( () => 'file:///site/a.php' ),
			waitForDiagnostics: vi.fn( async () => diagnostics ),
		},
	} as unknown as LspServer;
}

describe( 'isPhpFile', () => {
	it( 'matches php and phtml, not other extensions', () => {
		expect( isPhpFile( '/a/b.php' ) ).toBe( true );
		expect( isPhpFile( '/a/b.PHTML' ) ).toBe( true );
		expect( isPhpFile( '/a/b.js' ) ).toBe( false );
		expect( isPhpFile( '/a/php' ) ).toBe( false );
	} );
} );

describe( 'collectPhpFileDiagnostics', () => {
	let phpFile: string;
	let tempDir: string;

	beforeEach( () => {
		tempDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-lsp-diag-' ) );
		phpFile = path.join( tempDir, 'plugin.php' );
		fs.writeFileSync( phpFile, "<?php add_action( 'ini', 'cb' );" );
		mockedAvailability.mockReturnValue( true );
		mockedSiteRoot.mockReturnValue( tempDir );
	} );

	afterEach( () => {
		fs.rmSync( tempDir, { recursive: true, force: true } );
		vi.clearAllMocks();
	} );

	it( 'formats pushed diagnostics into a problems report', async () => {
		mockedGetServer.mockResolvedValue(
			fakeServer( [
				{
					range: { start: { line: 0, character: 6 }, end: { line: 0, character: 16 } },
					severity: 2,
					code: 'unknown-hook',
					message: "Unknown hook 'ini'. Did you mean 'init'?",
				},
			] )
		);
		const report = await collectPhpFileDiagnostics( phpFile );
		expect( report ).toBe(
			"wp-lsp found problems in this file:\nWarning line 1: Unknown hook 'ini'. Did you mean 'init'? [unknown-hook]"
		);
	} );

	it( 'returns null when there are no diagnostics', async () => {
		mockedGetServer.mockResolvedValue( fakeServer( [] ) );
		await expect( collectPhpFileDiagnostics( phpFile ) ).resolves.toBeNull();
	} );

	it( 'returns null for non-PHP files without touching the pool', async () => {
		await expect( collectPhpFileDiagnostics( '/site/style.css' ) ).resolves.toBeNull();
		expect( mockedGetServer ).not.toHaveBeenCalled();
	} );

	it( 'returns null when wp-lsp is unavailable', async () => {
		mockedAvailability.mockReturnValue( false );
		await expect( collectPhpFileDiagnostics( phpFile ) ).resolves.toBeNull();
	} );

	it( 'returns null for files outside any site', async () => {
		mockedSiteRoot.mockReturnValue( null );
		await expect( collectPhpFileDiagnostics( phpFile ) ).resolves.toBeNull();
	} );

	it( 'returns null instead of throwing when the server errors', async () => {
		mockedGetServer.mockRejectedValue( new Error( 'boom' ) );
		await expect( collectPhpFileDiagnostics( phpFile ) ).resolves.toBeNull();
	} );

	it( 'marks the server warm after a successful wait', async () => {
		const server = fakeServer( [] );
		server.warmedUp = false;
		mockedGetServer.mockResolvedValue( server );
		await collectPhpFileDiagnostics( phpFile );
		expect( server.warmedUp ).toBe( true );
	} );
} );

describe( 'collectEditToolDiagnostics', () => {
	afterEach( () => {
		vi.clearAllMocks();
	} );

	it( 'ignores tools other than Edit and Write', async () => {
		await expect(
			collectEditToolDiagnostics( 'Bash', { path: '/site/a.php' } )
		).resolves.toBeNull();
		expect( mockedAvailability ).not.toHaveBeenCalled();
	} );

	it( 'ignores calls without a usable path argument', async () => {
		await expect( collectEditToolDiagnostics( 'Edit', {} ) ).resolves.toBeNull();
		await expect( collectEditToolDiagnostics( 'Write', undefined ) ).resolves.toBeNull();
	} );

	it( 'resolves relative paths against the sites root', async () => {
		mockedAvailability.mockReturnValue( true );
		mockedSiteRoot.mockReturnValue( null );
		await collectEditToolDiagnostics( 'Edit', { path: 'my-site/wp-content/a.php' } );
		expect( mockedSiteRoot ).toHaveBeenCalledWith(
			path.join( STUDIO_SITES_ROOT, 'my-site/wp-content/a.php' )
		);
	} );

	it( 'accepts the file_path argument alias', async () => {
		mockedAvailability.mockReturnValue( true );
		mockedSiteRoot.mockReturnValue( null );
		await collectEditToolDiagnostics( 'Write', { file_path: '/abs/site/b.php' } );
		expect( mockedSiteRoot ).toHaveBeenCalledWith( '/abs/site/b.php' );
	} );
} );
