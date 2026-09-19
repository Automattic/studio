/**
 * @vitest-environment node
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const studioRoot = resolve( import.meta.dirname, '../../..' );
const captureExportSourcePath = resolve(
	studioRoot,
	'packages/data-liberation-agent/src/lib/capture-export.ts'
);
const packagedCaptureExportPath = resolve(
	studioRoot,
	'apps/cli/dist/cli/data-liberation-agent/dist/lib/capture-export.js'
);

it(
	'packages current Data Liberation source after consecutive CLI builds',
	{ tags: [ 'e2e' ], timeout: 180_000 },
	() => {
		const source = readFileSync( captureExportSourcePath, 'utf8' );
		const marker = `incremental-build-${ Date.now() }`;

		try {
			execSync( 'npm run cli:build', { cwd: studioRoot, stdio: 'inherit' } );
			writeFileSync(
				captureExportSourcePath,
				`${ source }\nexport const ${ marker.replace( /-/g, '_' ) } = '${ marker }';\n`
			);
			execSync( 'npm run cli:build', { cwd: studioRoot, stdio: 'inherit' } );

			expect( readFileSync( packagedCaptureExportPath, 'utf8' ) ).toContain( marker );
		} finally {
			writeFileSync( captureExportSourcePath, source );
			execSync( 'npm run cli:build', { cwd: studioRoot, stdio: 'inherit' } );
		}
	}
);
