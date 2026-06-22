import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureMailpitBinaryAvailable } from 'cli/lib/dependency-management/mailpit-binary';
import {
	getBundledMailpitBinaryPath,
	getRuntimeMailpitBinaryPath,
} from 'cli/lib/dependency-management/paths';

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getBundledMailpitBinaryPath: vi.fn(),
	getRuntimeMailpitBinaryPath: vi.fn(),
} ) );

describe( 'ensureMailpitBinaryAvailable', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'mailpit-binary-test-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
		vi.clearAllMocks();
	} );

	it( 'prefers the bundled binary when present', async () => {
		const bundled = path.join( tmpDir, 'bundled-mailpit' );
		fs.writeFileSync( bundled, '' );
		vi.mocked( getBundledMailpitBinaryPath ).mockReturnValue( bundled );
		vi.mocked( getRuntimeMailpitBinaryPath ).mockReturnValue(
			path.join( tmpDir, 'runtime-missing' )
		);

		await expect( ensureMailpitBinaryAvailable() ).resolves.toBe( bundled );
	} );

	it( 'falls back to an already-downloaded runtime binary without re-downloading', async () => {
		const runtime = path.join( tmpDir, 'runtime-mailpit' );
		fs.writeFileSync( runtime, '' );
		vi.mocked( getBundledMailpitBinaryPath ).mockReturnValue(
			path.join( tmpDir, 'bundled-missing' )
		);
		vi.mocked( getRuntimeMailpitBinaryPath ).mockReturnValue( runtime );

		await expect( ensureMailpitBinaryAvailable() ).resolves.toBe( runtime );
	} );
} );
