/**
 * Downloads the data-heavy e2e fixtures declared in test-fixtures/manifest.json
 * into test-fixtures/downloads/, verifying every file against its manifest
 * SHA-256. Files that already verify are skipped, so repeat runs are cheap and
 * a corrupted download self-heals on the next run.
 *
 * When `innerFilename` is set the hosted artifact is a zip wrapper (see
 * test-fixtures/readme.md for why): the wrapper hash is verified before
 * extraction and the inner file's hash after.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { z } from 'zod';
import { downloadFile } from './download-file.ts';
import { extractZip } from './extract-zip.ts';

const sha256Schema = z.string().regex( /^[0-9a-f]{64}$/ );

const fixtureSchema = z
	.object( {
		name: z.string().min( 1 ),
		description: z.string().min( 1 ),
		url: z.string().url(),
		sha256: sha256Schema,
		bytes: z.number().int().positive(),
		innerFilename: z.string().min( 1 ).optional(),
		innerSha256: sha256Schema.optional(),
	} )
	.refine(
		( fixture ) =>
			( fixture.innerFilename === undefined ) === ( fixture.innerSha256 === undefined ),
		{ message: 'innerFilename and innerSha256 must be provided together' }
	);

const manifestSchema = z.object( { fixtures: z.array( fixtureSchema ) } );

export type E2eFixture = z.infer< typeof fixtureSchema >;

/**
 * Ensures every manifest fixture exists, verified, in test-fixtures/downloads/.
 *
 * Returns the names of fixtures that could not be prepared. With
 * `require: true` (CI) a missing fixture throws instead, so fixture problems
 * fail the run rather than surface as silently skipped tests. An invalid
 * manifest always throws — that's a repo bug, not an environment issue.
 */
export async function prepareE2eFixtures( options: {
	require: boolean;
	rootDir: string;
} ): Promise< { missing: string[] } > {
	const manifestPath = path.join( options.rootDir, 'test-fixtures', 'manifest.json' );
	const downloadsDir = path.join( options.rootDir, 'test-fixtures', 'downloads' );

	const manifest = manifestSchema.parse( JSON.parse( fs.readFileSync( manifestPath, 'utf8' ) ) );
	fs.mkdirSync( downloadsDir, { recursive: true } );

	const missing: string[] = [];
	for ( const fixture of manifest.fixtures ) {
		try {
			await prepareFixture( fixture, downloadsDir );
		} catch ( error ) {
			missing.push( fixture.name );
			console.warn( `${ fixture.name }: unavailable — ${ ( error as Error ).message }` );
		}
	}

	if ( missing.length > 0 ) {
		const summary = `Missing e2e fixtures: ${ missing.join( ', ' ) }.`;
		if ( options.require ) {
			throw new Error( `${ summary } Fixture downloads are required in CI.` );
		}
		console.warn(
			`${ summary } Tests that need them will skip — re-run \`npm run e2e:fixtures\` when online.`
		);
	}

	return { missing };
}

async function prepareFixture( fixture: E2eFixture, downloadsDir: string ): Promise< void > {
	const targetPath = path.join( downloadsDir, fixture.name );
	const expectedTargetSha = fixture.innerSha256 ?? fixture.sha256;

	if ( fs.existsSync( targetPath ) && ( await hashFile( targetPath ) ) === expectedTargetSha ) {
		console.log( `${ fixture.name }: already downloaded and verified — skipping.` );
		return;
	}

	// Work next to the target so the final rename never crosses filesystems.
	const workDir = fs.mkdtempSync( path.join( downloadsDir, '.tmp-' ) );
	try {
		const downloadPath = path.join( workDir, path.basename( new URL( fixture.url ).pathname ) );
		console.log( `${ fixture.name }: downloading ${ fixture.url }` );
		await downloadFile( fixture.url, downloadPath, ( downloaded ) => {
			const dl = ( downloaded / 1024 / 1024 ).toFixed( 1 );
			const total = ( fixture.bytes / 1024 / 1024 ).toFixed( 1 );
			process.stdout.write( `\r  ${ dl } / ${ total } MB` );
		} );
		process.stdout.write( '\n' );

		const downloadSha = await hashFile( downloadPath );
		if ( downloadSha !== fixture.sha256 ) {
			throw new Error(
				`SHA-256 mismatch for ${ fixture.url }:\n  expected ${ fixture.sha256 }\n  got      ${ downloadSha }`
			);
		}

		let sourcePath = downloadPath;
		if ( fixture.innerFilename && fixture.innerSha256 ) {
			const extractDir = path.join( workDir, 'extracted' );
			await extractZip( downloadPath, extractDir );
			sourcePath = path.join( extractDir, fixture.innerFilename );
			if ( ! fs.existsSync( sourcePath ) ) {
				throw new Error( `${ fixture.innerFilename } not found in the downloaded zip wrapper` );
			}
			const innerSha = await hashFile( sourcePath );
			if ( innerSha !== fixture.innerSha256 ) {
				throw new Error(
					`SHA-256 mismatch for ${ fixture.innerFilename }:\n  expected ${ fixture.innerSha256 }\n  got      ${ innerSha }`
				);
			}
		}

		// fs.renameSync can't replace an existing file on Windows.
		fs.rmSync( targetPath, { force: true } );
		fs.renameSync( sourcePath, targetPath );
		console.log( `${ fixture.name }: ready.` );
	} finally {
		fs.rmSync( workDir, { recursive: true, force: true } );
	}
}

async function hashFile( filePath: string ): Promise< string > {
	const hash = crypto.createHash( 'sha256' );
	await pipeline( fs.createReadStream( filePath ), hash );
	return hash.digest( 'hex' );
}
