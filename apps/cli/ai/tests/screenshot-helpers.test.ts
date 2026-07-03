import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setScreenshotDirectoryProvider } from '../screenshot-storage';
import { saveScreenshotFile } from '../tools/screenshot-helpers';

describe( 'screenshot helpers', () => {
	afterEach( () => {
		setScreenshotDirectoryProvider( null );
	} );

	it( 'falls back to a temporary directory when no provider is set', async () => {
		const buffer = Buffer.from( 'not-really-a-png' );
		const result = await saveScreenshotFile( buffer, { viewportType: 'desktop' } );

		try {
			expect( result.path.startsWith( os.tmpdir() ) ).toBe( true );
			expect( result.fileUrl.startsWith( 'file://' ) ).toBe( true );
			expect( result.name ).toMatch( /^screenshot-desktop-[0-9a-f]{8}\.png$/ );
			expect( result.mimeType ).toBe( 'image/png' );
			await expect( readFile( result.path ) ).resolves.toEqual( buffer );
		} finally {
			await rm( path.dirname( result.path ), { recursive: true, force: true } );
		}
	} );

	it( 'saves captures into the provided session directory with unique names', async () => {
		const sessionRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-session-' ) );
		const screenshotsDirectory = path.join( sessionRoot, 'session.screenshots' );
		setScreenshotDirectoryProvider( () => screenshotsDirectory );

		try {
			const first = await saveScreenshotFile( Buffer.from( 'first' ), {
				viewportType: 'desktop',
				format: 'jpeg',
				colorScheme: 'dark',
			} );
			const second = await saveScreenshotFile( Buffer.from( 'second' ), {
				viewportType: 'desktop',
				format: 'jpeg',
				colorScheme: 'dark',
			} );

			expect( path.dirname( first.path ) ).toBe( screenshotsDirectory );
			expect( first.name ).toMatch( /^screenshot-desktop-dark-[0-9a-f]{8}\.jpg$/ );
			expect( first.name ).not.toBe( second.name );
			await expect( readFile( first.path, 'utf8' ) ).resolves.toBe( 'first' );
			await expect( readFile( second.path, 'utf8' ) ).resolves.toBe( 'second' );
			await expect( readdir( screenshotsDirectory ) ).resolves.toHaveLength( 2 );
		} finally {
			await rm( sessionRoot, { recursive: true, force: true } );
		}
	} );

	it( 'falls back to a temporary directory when the provider throws', async () => {
		setScreenshotDirectoryProvider( () => {
			throw new Error( 'no session' );
		} );

		const result = await saveScreenshotFile( Buffer.from( 'fallback' ), {
			viewportType: 'mobile',
		} );

		try {
			expect( result.path.startsWith( os.tmpdir() ) ).toBe( true );
		} finally {
			await rm( path.dirname( result.path ), { recursive: true, force: true } );
		}
	} );
} );
