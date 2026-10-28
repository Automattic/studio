import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { nodeHostServices } from '@studio/agent/node/node-host';
import { saveScreenshotFile } from '@studio/agent/node/tools/screenshot-helpers';
import { createFakeHost } from './fake-host';

describe( 'screenshot helpers', () => {
	it( 'falls back to a temporary directory when the host names none', async () => {
		const buffer = Buffer.from( 'not-really-a-png' );
		const host = { ...createFakeHost(), saveImage: nodeHostServices().saveImage };
		const result = await saveScreenshotFile( host, buffer, {
			viewportType: 'desktop',
		} );

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

	it( "saves captures into the host's session directory with unique names", async () => {
		const sessionRoot = await mkdtemp( path.join( os.tmpdir(), 'studio-session-' ) );
		const screenshotsDirectory = path.join( sessionRoot, 'session.screenshots' );
		const host = {
			...createFakeHost(),
			saveImage: nodeHostServices( { imagesDirectory: () => screenshotsDirectory } ).saveImage,
		};

		try {
			const first = await saveScreenshotFile( host, Buffer.from( 'first' ), {
				viewportType: 'desktop',
				format: 'jpeg',
				colorScheme: 'dark',
			} );
			const second = await saveScreenshotFile( host, Buffer.from( 'second' ), {
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

	it( 'falls back to a temporary directory when the host cannot name one, and says so', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const host = {
			...createFakeHost(),
			saveImage: nodeHostServices( {
				imagesDirectory: () => {
					throw new Error( 'no session' );
				},
			} ).saveImage,
		};

		const result = await saveScreenshotFile( host, Buffer.from( 'fallback' ), {
			viewportType: 'mobile',
		} );

		try {
			expect( result.path.startsWith( os.tmpdir() ) ).toBe( true );
			expect( warnSpy ).toHaveBeenCalledWith(
				expect.stringContaining( '[screenshots] falling back to a temporary directory' ),
				expect.any( Error )
			);
		} finally {
			warnSpy.mockRestore();
			await rm( path.dirname( result.path ), { recursive: true, force: true } );
		}
	} );
} );
