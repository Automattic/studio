import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	clearStudioMainExtensionCache,
	getStudioExtensionHandler,
} from 'src/extensions/main-registry';
import type { IpcMainInvokeEvent } from 'electron';
import type { InstalledStudioExtensionPackage } from 'src/extensions/types';

let testDirectory: string;

describe( 'Studio extension main registry', () => {
	beforeEach( async () => {
		testDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-extension-main-' ) );
		clearStudioMainExtensionCache();
	} );

	afterEach( async () => {
		clearStudioMainExtensionCache();
		await fs.rm( testDirectory, { recursive: true, force: true } );
	} );

	it( 'loads namespaced handlers from an installed extension directory', async () => {
		const mainPath = path.join( testDirectory, 'main.cjs' );
		await fs.writeFile(
			mainPath,
			`
				module.exports.handlers = {
					echo: async (_event, value) => value,
				};
			`,
			'utf8'
		);

		const extensionPackage: InstalledStudioExtensionPackage = {
			manifest: {
				id: 'sample-extension',
				name: 'Sample Extension',
				description: 'Adds sample contributions.',
				version: '1.0.0',
				main: 'main.cjs',
			},
			installedPath: testDirectory,
		};

		const handler = await getStudioExtensionHandler( extensionPackage, 'echo' );

		await expect( handler?.( {} as IpcMainInvokeEvent, 'loaded' ) ).resolves.toBe( 'loaded' );
	} );

	it( 'rejects main entries outside the extension directory', async () => {
		const extensionPackage: InstalledStudioExtensionPackage = {
			manifest: {
				id: 'sample-extension',
				name: 'Sample Extension',
				description: 'Adds sample contributions.',
				version: '1.0.0',
				main: '../main.mjs',
			},
			installedPath: testDirectory,
		};

		await expect( getStudioExtensionHandler( extensionPackage, 'echo' ) ).rejects.toThrow(
			'Studio extension main entry must stay inside the extension directory.'
		);
	} );
} );
