/**
 * Tests for `scripts/download-data-liberation-agent.ts`.
 *
 * Coverage:
 *   - skip-when-missing-token branch returns 0 (no fetch invoked)
 *   - target paths copied verbatim from a fixture tarball
 *   - `dist-vendored/` is renamed to `src/`
 *   - `.dla-pinned-sha` file is written with the pinned SHA
 *
 * The fixture tarball is created in-process with `tar.create`. Network is mocked.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { create as tarCreate } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDataLiberationAgent } from '../download-data-liberation-agent';

const TARBALL_ROOT = 'Automattic-data-liberation-agent-abc1234';

let workDir: string;
let destDir: string;

beforeEach( () => {
	workDir = fs.mkdtempSync( path.join( os.tmpdir(), 'dla-fetch-test-' ) );
	destDir = path.join( workDir, 'dla' );

	delete process.env.GH_PAT;
	delete process.env.GH_TOKEN;
	delete process.env.STUDIO_REFRESH_DLA;
} );

afterEach( () => {
	fs.rmSync( workDir, { recursive: true, force: true } );
	vi.restoreAllMocks();
} );

/**
 * Builds a fixture DLA tree on disk and returns the path to its root directory.
 * The tree mirrors the subset of paths the fetch script vendors.
 */
function buildFixtureTree( rootDir: string ): string {
	const root = path.join( rootDir, TARBALL_ROOT );

	const files: Record< string, string > = {
		'.claude-plugin/plugin.json': JSON.stringify( {
			name: 'data-liberation',
			version: '0.0.0',
		} ),
		'skills/migrate-source/SKILL.md': '# Migrate source skill\n',
		'commands/liberate.md': '# Liberate command\n',
		'prompts/identify.md': '# Identify prompt\n',
		'src/lib/preview/scripts/serve.php': '<?php // preview helper\n',
		'src/index.ts': 'export const version = "0.0.0";\n',
		'tsconfig.json': JSON.stringify( {
			compilerOptions: { module: 'esnext', target: 'es2022' },
			include: [ 'src/**/*' ],
		} ),
		'package.json': JSON.stringify( { name: 'data-liberation-agent' } ),
		'README.md': '# DLA\n',
	};

	for ( const [ relPath, content ] of Object.entries( files ) ) {
		const full = path.join( root, relPath );
		fs.mkdirSync( path.dirname( full ), { recursive: true } );
		fs.writeFileSync( full, content );
	}

	return root;
}

/**
 * Creates a gzipped tar archive of `root` (single top-level directory) and returns
 * its raw bytes — what GitHub's tarball endpoint hands back.
 */
async function makeTarball( root: string ): Promise< Buffer > {
	const tarPath = path.join( os.tmpdir(), `dla-fixture-${ Date.now() }.tgz` );
	await tarCreate(
		{
			file: tarPath,
			cwd: path.dirname( root ),
			gzip: true,
		},
		[ path.basename( root ) ]
	);
	const bytes = fs.readFileSync( tarPath );
	fs.unlinkSync( tarPath );
	return bytes;
}

/**
 * Builds a `fetch`-shaped mock that resolves with the given tarball bytes.
 */
function makeFetchMock( bytes: Buffer ): typeof fetch {
	const response = {
		ok: true,
		status: 200,
		statusText: 'OK',
		arrayBuffer: async () =>
			bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength ),
	};
	return vi.fn().mockResolvedValue( response ) as unknown as typeof fetch;
}

/**
 * No-op compiler: simulates a successful `tsc` run by creating an empty `dist-vendored/`
 * with one file derived from the input tree. Avoids invoking the real compiler in tests.
 */
function makeStubCompiler(): ( cwd: string, _tsconfig: string, outDir: string ) => Promise< void > {
	return async ( cwd: string, _tsconfig: string, outDir: string ) => {
		const fullOut = path.join( cwd, outDir );
		fs.mkdirSync( path.join( fullOut, 'lib', 'preview', 'scripts' ), { recursive: true } );
		fs.writeFileSync(
			path.join( fullOut, 'index.js' ),
			'module.exports = { version: "0.0.0" };\n'
		);
		fs.writeFileSync(
			path.join( fullOut, 'lib', 'preview', 'scripts', 'serve.js' ),
			'module.exports = {};\n'
		);
	};
}

describe( 'downloadDataLiberationAgent', () => {
	it( 'returns 0 and skips fetch when no GH token is set', async () => {
		const fetchMock = vi.fn();
		const compilerMock = vi.fn();
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		const code = await downloadDataLiberationAgent( {
			destDir,
			pinnedSha: 'abc1234',
			ghToken: null,
			fetchImpl: fetchMock as unknown as typeof fetch,
			runCompiler: compilerMock,
		} );

		expect( code ).toBe( 0 );
		expect( fetchMock ).not.toHaveBeenCalled();
		expect( compilerMock ).not.toHaveBeenCalled();
		expect( fs.existsSync( destDir ) ).toBe( false );

		const message = warnSpy.mock.calls.map( ( c ) => c.join( ' ' ) ).join( '\n' );
		expect( message ).toMatch( /Skipping DLA download/ );
		expect( message ).toMatch( /GH_PAT/ );
		expect( message ).toMatch( /\/migrate will not work/ );
	} );

	it( 'copies vendored paths verbatim from the fetched tarball', async () => {
		const root = buildFixtureTree( workDir );
		const tarBytes = await makeTarball( root );
		const fetchMock = makeFetchMock( tarBytes );

		const code = await downloadDataLiberationAgent( {
			destDir,
			pinnedSha: 'abc1234',
			ghToken: 'fake-token',
			fetchImpl: fetchMock,
			runCompiler: makeStubCompiler(),
		} );

		expect( code ).toBe( 0 );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );

		// The fetched URL targets the pinned SHA on the private repo.
		const calledWith = ( fetchMock as unknown as ReturnType< typeof vi.fn > ).mock.calls[ 0 ];
		expect( calledWith[ 0 ] ).toBe(
			'https://api.github.com/repos/Automattic/data-liberation-agent/tarball/abc1234'
		);
		const headers = ( calledWith[ 1 ] as { headers: Record< string, string > } ).headers;
		expect( headers.Authorization ).toBe( 'Bearer fake-token' );
		expect( headers.Accept ).toBe( 'application/vnd.github+json' );

		// Verbatim copies from the tarball.
		expect( fs.existsSync( path.join( destDir, '.claude-plugin', 'plugin.json' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( destDir, 'skills', 'migrate-source', 'SKILL.md' ) ) ).toBe(
			true
		);
		expect( fs.existsSync( path.join( destDir, 'commands', 'liberate.md' ) ) ).toBe( true );
		expect( fs.existsSync( path.join( destDir, 'prompts', 'identify.md' ) ) ).toBe( true );

		// PHP scripts under src/lib/preview/scripts/ ship verbatim (referenced via import.meta.url).
		expect(
			fs.existsSync( path.join( destDir, 'src', 'lib', 'preview', 'scripts', 'serve.php' ) )
		).toBe( true );
	} );

	it( 'renames `dist-vendored/` to `src/` after compilation', async () => {
		const root = buildFixtureTree( workDir );
		const tarBytes = await makeTarball( root );
		const fetchMock = makeFetchMock( tarBytes );

		await downloadDataLiberationAgent( {
			destDir,
			pinnedSha: 'abc1234',
			ghToken: 'fake-token',
			fetchImpl: fetchMock,
			runCompiler: makeStubCompiler(),
		} );

		// Compiled JS landed at dist-vendored/ in the extracted tree, then renamed to src/.
		expect( fs.existsSync( path.join( destDir, 'src', 'index.js' ) ) ).toBe( true );

		// dist-vendored/ must not appear at the destination.
		expect( fs.existsSync( path.join( destDir, 'dist-vendored' ) ) ).toBe( false );
	} );

	it( 'writes the pinned SHA to `.dla-pinned-sha`', async () => {
		const root = buildFixtureTree( workDir );
		const tarBytes = await makeTarball( root );
		const fetchMock = makeFetchMock( tarBytes );

		await downloadDataLiberationAgent( {
			destDir,
			pinnedSha: 'abc1234',
			ghToken: 'fake-token',
			fetchImpl: fetchMock,
			runCompiler: makeStubCompiler(),
		} );

		const shaFile = path.join( destDir, '.dla-pinned-sha' );
		expect( fs.existsSync( shaFile ) ).toBe( true );
		expect( fs.readFileSync( shaFile, 'utf8' ).trim() ).toBe( 'abc1234' );
	} );
} );
