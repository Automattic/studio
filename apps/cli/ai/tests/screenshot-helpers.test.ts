import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setScreenshotDirectoryProvider } from '../screenshot-storage';
import {
	countImageTokens,
	fitImageToModelResolution,
	saveScreenshotFile,
} from '../tools/screenshot-helpers';

describe( 'screenshot helpers', () => {
	afterEach( () => {
		setScreenshotDirectoryProvider( null );
	} );

	// Sizes from Anthropic's vision docs (high-resolution tier) and from the
	// tall full-page captures take_screenshot produces.
	it( 'fits images to the size the vision API would reduce them to', () => {
		expect( fitImageToModelResolution( { width: 1920, height: 1080 } ) ).toEqual( {
			width: 1920,
			height: 1080,
		} );
		expect( fitImageToModelResolution( { width: 2000, height: 1500 } ) ).toEqual( {
			width: 2000,
			height: 1500,
		} );
		expect( fitImageToModelResolution( { width: 3840, height: 2160 } ) ).toEqual( {
			width: 2576,
			height: 1449,
		} );
		expect( fitImageToModelResolution( { width: 1040, height: 5662 } ) ).toEqual( {
			width: 473,
			height: 2576,
		} );
		expect( fitImageToModelResolution( { width: 390, height: 3993 } ) ).toEqual( {
			width: 252,
			height: 2576,
		} );
		expect( fitImageToModelResolution( { width: 1040, height: 1248 } ) ).toEqual( {
			width: 1040,
			height: 1248,
		} );
		expect( countImageTokens( { width: 473, height: 2576 } ) ).toBe( 1564 );
		expect( countImageTokens( { width: 2576, height: 1449 } ) ).toBe( 4784 );
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

	it( 'falls back to a temporary directory when the provider throws, and says so', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		setScreenshotDirectoryProvider( () => {
			throw new Error( 'no session' );
		} );

		const result = await saveScreenshotFile( Buffer.from( 'fallback' ), {
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
