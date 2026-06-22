import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	STUDIO_EXTENSION_MANIFEST_FILE,
	installStudioExtensionFromDirectorySource,
	normalizeGitSourceUrl,
	readStudioExtensionManifest,
	resolveLocalExtensionPath,
} from 'src/extensions/package-manager';

const mockExtensionsDirectory = vi.hoisted( () => ( {
	value: '',
} ) );

vi.mock( '@studio/common/lib/well-known-paths', () => ( {
	getStudioExtensionsDirectory: () => mockExtensionsDirectory.value,
} ) );

let testDirectory: string;

describe( 'Studio extension package manager', () => {
	beforeEach( async () => {
		testDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-extension-' ) );
		mockExtensionsDirectory.value = path.join( testDirectory, 'installed' );
	} );

	afterEach( async () => {
		await fs.rm( testDirectory, { recursive: true, force: true } );
	} );

	it( 'reads a valid Studio extension manifest', async () => {
		await fs.writeFile(
			path.join( testDirectory, STUDIO_EXTENSION_MANIFEST_FILE ),
			JSON.stringify( {
				studioExtensionApiVersion: 1,
				id: 'example-extension',
				name: 'Example Extension',
				description: 'Adds an example contribution.',
				version: '1.0.0',
				main: 'main.js',
				renderer: 'renderer.js',
			} ),
			'utf8'
		);

		await expect( readStudioExtensionManifest( testDirectory ) ).resolves.toMatchObject( {
			id: 'example-extension',
			name: 'Example Extension',
			description: 'Adds an example contribution.',
			version: '1.0.0',
			main: 'main.js',
			renderer: 'renderer.js',
			studioExtensionApiVersion: 1,
		} );
	} );

	it( 'rejects unsafe manifest ids', async () => {
		await fs.writeFile(
			path.join( testDirectory, STUDIO_EXTENSION_MANIFEST_FILE ),
			JSON.stringify( {
				studioExtensionApiVersion: 1,
				id: '../unsafe',
				name: 'Unsafe Extension',
				description: 'Should not install.',
				version: '1.0.0',
			} ),
			'utf8'
		);

		await expect( readStudioExtensionManifest( testDirectory ) ).rejects.toThrow(
			'Invalid Studio extension id: ../unsafe'
		);
	} );

	it( 'normalizes GitHub shorthand URLs', () => {
		expect( normalizeGitSourceUrl( 'github.com/example/studio-extension' ) ).toBe(
			'https://github.com/example/studio-extension'
		);
		expect( normalizeGitSourceUrl( 'example/studio-extension' ) ).toBe(
			'https://github.com/example/studio-extension'
		);
		expect( normalizeGitSourceUrl( 'git@github.com:example/studio-extension.git' ) ).toBe(
			'git@github.com:example/studio-extension.git'
		);
	} );

	it( 'resolves tilde-prefixed local extension paths', () => {
		expect( resolveLocalExtensionPath( '~/Code/example-extension' ) ).toBe(
			path.join( os.homedir(), 'Code/example-extension' )
		);
	} );

	it( 'installs extensions from a local directory into the Studio extensions directory', async () => {
		const sourceDirectory = path.join( testDirectory, 'source-extension' );
		await fs.mkdir( sourceDirectory, { recursive: true } );
		await fs.writeFile(
			path.join( sourceDirectory, STUDIO_EXTENSION_MANIFEST_FILE ),
			JSON.stringify( {
				studioExtensionApiVersion: 1,
				id: 'example-extension',
				name: 'Example Extension',
				description: 'Adds an example contribution.',
				version: '1.0.0',
			} ),
			'utf8'
		);
		await fs.writeFile(
			path.join( sourceDirectory, 'main.mjs' ),
			'export const handlers = {};',
			'utf8'
		);

		await expect( installStudioExtensionFromDirectorySource( sourceDirectory ) ).resolves.toEqual( {
			manifest: expect.objectContaining( {
				id: 'example-extension',
				kind: 'user',
			} ),
			installedPath: path.join( mockExtensionsDirectory.value, 'example-extension' ),
		} );
		await expect(
			fs.readFile(
				path.join(
					mockExtensionsDirectory.value,
					'example-extension',
					STUDIO_EXTENSION_MANIFEST_FILE
				),
				'utf8'
			)
		).resolves.toContain( 'Example Extension' );
	} );
} );
