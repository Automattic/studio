import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getPulledSiteStartOptions } from './pulled-site-start-options';
import type { SiteData } from 'cli/lib/cli-config/core';

describe( 'getPulledSiteStartOptions', () => {
	const makeSite = ( overrides: Partial< SiteData > = {} ): SiteData => ( {
		id: 'test-id',
		name: 'Test Site',
		path: '/tmp/test-site',
		port: 8881,
		phpVersion: '8.4',
		...overrides,
	} );

	it( 'returns runtime.php as the prepend file for a pulled site that has it', () => {
		const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-' ) );
		const runtimeDir = path.join( importRoot, 'runtime' );
		const runtimeBlueprintPath = path.join( runtimeDir, 'blueprint.json' );
		const runtimePhpPath = path.join( runtimeDir, 'runtime.php' );

		try {
			fs.mkdirSync( runtimeDir, { recursive: true } );
			fs.writeFileSync( runtimeBlueprintPath, '{}' );
			fs.writeFileSync( runtimePhpPath, '<?php' );

			expect(
				getPulledSiteStartOptions(
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
		expect( getPulledSiteStartOptions( makeSite() ) ).toBeUndefined();
	} );

	it( 'returns undefined (does not throw) when runtime.php is missing', () => {
		const importRoot = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-prepend-missing-' ) );
		const runtimeBlueprintPath = path.join( importRoot, 'runtime', 'blueprint.json' );

		try {
			fs.mkdirSync( path.dirname( runtimeBlueprintPath ), { recursive: true } );
			fs.writeFileSync( runtimeBlueprintPath, '{}' );
			// Intentionally no runtime.php written.
			expect( getPulledSiteStartOptions( makeSite( { runtimeBlueprintPath } ) ) ).toBeUndefined();
		} finally {
			fs.rmSync( importRoot, { recursive: true, force: true } );
		}
	} );
} );
