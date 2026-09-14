import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';

const blocksEnginePath = process.env.BLOCKS_ENGINE_FIGMA_TRANSFORMER_PATH;
const phpWithZstd = process.env.PHP_BINARY_WITH_ZSTD;

test.skipIf( ! blocksEnginePath || ! phpWithZstd )(
	'generates a deterministic .fig fixture with the Blocks Engine helper',
	() => {
		const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-figma-fixture-' ) );
		const first = path.join( directory, 'first.fig' );
		const second = path.join( directory, 'second.fig' );
		const generator = path.join( import.meta.dirname, 'generate-figma-fixture.php' );
		const args = ( output ) => [
			generator,
			`--blocks-engine-path=${ blocksEnginePath }`,
			`--output=${ output }`,
		];

		try {
			execFileSync( phpWithZstd, args( first ), { stdio: 'pipe' } );
			execFileSync( phpWithZstd, args( second ), { stdio: 'pipe' } );
			const listing = execFileSync( 'unzip', [ '-l', first ], { encoding: 'utf8' } );

			assert.match( listing, /canvas\.fig/ );
			assert.match( listing, /meta\.json/ );
			assert.deepEqual( fs.readFileSync( first ), fs.readFileSync( second ) );
		} finally {
			fs.rmSync( directory, { recursive: true, force: true } );
		}
	}
);
