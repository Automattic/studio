import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
	findFirstPathOutsideTrustedRoots,
	isPathGatedTool,
	isPathWithinTrustedRoot,
	resolveToolPath,
	STUDIO_ROOT,
	TMP_ROOT,
} from 'cli/ai/security';

describe( 'isPathGatedTool', () => {
	it( 'returns true for write-side tools', () => {
		expect( isPathGatedTool( 'Write' ) ).toBe( true );
		expect( isPathGatedTool( 'Edit' ) ).toBe( true );
		expect( isPathGatedTool( 'NotebookEdit' ) ).toBe( true );
	} );

	it( 'returns false for read-side tools', () => {
		expect( isPathGatedTool( 'Read' ) ).toBe( false );
		expect( isPathGatedTool( 'Grep' ) ).toBe( false );
		expect( isPathGatedTool( 'Glob' ) ).toBe( false );
	} );

	// Bash is intentionally not gated by static path classification — its
	// `command` arg isn't a structured path. Document the choice as a test
	// so an accidental "promote Bash to PATH_GATED_TOOLS" edit fails CI.
	it( 'returns false for Bash', () => {
		expect( isPathGatedTool( 'Bash' ) ).toBe( false );
	} );
} );

describe( 'resolveToolPath', () => {
	it( 'expands ~/ to the home directory', () => {
		const resolved = resolveToolPath( '~/site/file.txt' );
		expect( resolved ).toBe( path.join( os.homedir(), 'site/file.txt' ) );
	} );

	it( 'resolves relative paths against STUDIO_ROOT', () => {
		const resolved = resolveToolPath( 'project/index.php' );
		expect( resolved ).toBe( path.join( STUDIO_ROOT, 'project/index.php' ) );
	} );

	it( 'leaves absolute paths intact', () => {
		const resolved = resolveToolPath( '/etc/hosts' );
		expect( resolved ).toBe( '/etc/hosts' );
	} );
} );

describe( 'isPathWithinTrustedRoot', () => {
	it( 'allows paths inside STUDIO_ROOT', () => {
		expect( isPathWithinTrustedRoot( path.join( STUDIO_ROOT, 'site/wp-config.php' ) ) ).toBe( true );
	} );

	it( 'allows paths inside the OS tmp directory', () => {
		expect( isPathWithinTrustedRoot( path.join( TMP_ROOT, 'studio-temp.txt' ) ) ).toBe( true );
	} );

	it( 'allows paths inside /tmp', () => {
		expect( isPathWithinTrustedRoot( '/tmp/page-content.html' ) ).toBe( true );
	} );

	it( 'rejects paths outside trusted roots', () => {
		expect( isPathWithinTrustedRoot( '/etc/hosts' ) ).toBe( false );
		expect( isPathWithinTrustedRoot( path.join( os.homedir(), 'private/key' ) ) ).toBe( false );
	} );

	// Prefix-collision safety: a sibling directory whose name happens to start
	// with `STUDIO_ROOT` shouldn't be treated as inside it.
	it( 'does not treat sibling-prefix paths as inside the trusted root', () => {
		expect( isPathWithinTrustedRoot( `${ STUDIO_ROOT }-evil/file` ) ).toBe( false );
	} );
} );

describe( 'findFirstPathOutsideTrustedRoots', () => {
	it( 'returns the first outside path encountered across known input keys', () => {
		const found = findFirstPathOutsideTrustedRoots( {
			path: path.join( STUDIO_ROOT, 'ok.txt' ),
			file_path: '/etc/hosts',
			filePath: '/var/data/logs.txt',
		} );
		// The function walks `path`, `file_path`, then `filePath` in order, so
		// `/etc/hosts` is the first violation.
		expect( found ).toBe( '/etc/hosts' );
	} );

	it( 'returns undefined when every input path is inside a trusted root', () => {
		const found = findFirstPathOutsideTrustedRoots( {
			path: path.join( STUDIO_ROOT, 'ok.txt' ),
			file_path: path.join( TMP_ROOT, 'workspace.txt' ),
			filePath: '/tmp/scratch.html',
		} );
		expect( found ).toBeUndefined();
	} );

	it( 'returns undefined when no path-shaped keys are present', () => {
		const found = findFirstPathOutsideTrustedRoots( {
			content: 'arbitrary',
			limit: 10,
		} );
		expect( found ).toBeUndefined();
	} );

	it( 'ignores empty / non-string path values', () => {
		const found = findFirstPathOutsideTrustedRoots( {
			path: '',
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			file_path: 42 as any,
			filePath: '   ',
		} );
		expect( found ).toBeUndefined();
	} );
} );
