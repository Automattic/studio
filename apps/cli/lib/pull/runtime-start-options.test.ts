import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadImportedRuntimeStartOptions } from './runtime-start-options';
import type { SiteData } from '../cli-config/core';

describe( 'imported runtime start options', () => {
	describe( 'loadImportedRuntimeStartOptions', () => {
		const makeSite = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
			id: 'test-id',
			name: 'Test Site',
			path: '/tmp/test-site',
			port: 8881,
			phpVersion: '8.4',
			...overrides,
		} );

		it( 'returns runtime.php as the prepend file for an imported site that has it', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-' ) );
			const runtimeDir = path.join( importRoot, 'runtime' );
			const runtimeBlueprintPath = path.join( runtimeDir, 'blueprint.json' );
			const runtimePhpPath = path.join( runtimeDir, 'runtime.php' );

			try {
				fs.mkdirSync( runtimeDir, { recursive: true } );
				fs.writeFileSync( runtimeBlueprintPath, '{}' );
				fs.writeFileSync( runtimePhpPath, '<?php' );

				expect(
					loadImportedRuntimeStartOptions(
						makeSite( { runtimeBlueprintPath, technicalSiteDirectory: importRoot } )
					)
				).toEqual( {
					autoPrependFile: runtimePhpPath,
					openBasedirAllowList: [ importRoot ],
				} );
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );

		it( 'returns undefined for a normal site without runtimeBlueprintPath', () => {
			expect( loadImportedRuntimeStartOptions( makeSite() ) ).toBeUndefined();
		} );

		it( 'returns undefined (does not throw) when runtime.php is missing', () => {
			const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-missing-' ) );
			const runtimeBlueprintPath = path.join( importRoot, 'runtime', 'blueprint.json' );

			try {
				fs.mkdirSync( path.dirname( runtimeBlueprintPath ), { recursive: true } );
				fs.writeFileSync( runtimeBlueprintPath, '{}' );
				// Intentionally no runtime.php written.
				expect(
					loadImportedRuntimeStartOptions( makeSite( { runtimeBlueprintPath } ) )
				).toBeUndefined();
			} finally {
				fs.rmSync( importRoot, { recursive: true, force: true } );
			}
		} );
	} );
} );
