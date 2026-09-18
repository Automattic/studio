import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
	DIST_FILES,
	fetchUpstreamFile,
	findDivergentDistFiles,
	formatFailure,
	parseLsRemoteHead,
} from './check-data-liberation-agent-upstream.mjs';

test( 'parseLsRemoteHead extracts the SHA from git ls-remote output', () => {
	assert.equal(
		parseLsRemoteHead( '6e8131f4fe45c6e4b7a89c72ced833a468058427\tHEAD\n' ),
		'6e8131f4fe45c6e4b7a89c72ced833a468058427'
	);
} );

test( 'parseLsRemoteHead rejects output without a parseable SHA', () => {
	assert.throws( () => parseLsRemoteHead( '' ) );
	assert.throws( () => parseLsRemoteHead( 'not-a-sha\tHEAD\n' ) );
} );

test( 'fetchUpstreamFile requests the raw file at the given revision', async () => {
	const requests = [];
	const bytes = await fetchUpstreamFile(
		'deadbeef',
		'dist/capture-engine.bundle.mjs',
		async ( url ) => {
			requests.push( url );
			return { ok: true, arrayBuffer: async () => new TextEncoder().encode( 'content' ).buffer };
		}
	);

	assert.equal( requests.length, 1 );
	assert.equal(
		requests[ 0 ],
		'https://raw.githubusercontent.com/Automattic/data-liberation-agent/deadbeef/dist/capture-engine.bundle.mjs'
	);
	assert.equal( bytes.toString(), 'content' );
} );

test( 'fetchUpstreamFile rejects a non-OK response', async () => {
	await assert.rejects( () =>
		fetchUpstreamFile( 'deadbeef', 'dist/capture-engine.bundle.mjs', async () => ( {
			ok: false,
			status: 404,
			statusText: 'Not Found',
		} ) )
	);
} );

test( 'findDivergentDistFiles reports no drift when upstream matches the vendored bytes', async () => {
	const vendored = Object.fromEntries( DIST_FILES.map( ( file ) => [ file, `${ file }-bytes` ] ) );
	const divergent = await findDivergentDistFiles( 'deadbeef', {
		fetchImpl: async ( url ) => {
			const relativePath = DIST_FILES.find( ( file ) => url.endsWith( file ) );
			return {
				ok: true,
				arrayBuffer: async () => new TextEncoder().encode( vendored[ relativePath ] ).buffer,
			};
		},
		readFileImpl: ( filePath ) => {
			const relativePath = DIST_FILES.find( ( file ) => filePath.endsWith( file ) );
			return Buffer.from( vendored[ relativePath ] );
		},
	} );

	assert.deepEqual( divergent, [] );
} );

test( 'findDivergentDistFiles reports the files whose bytes differ from upstream', async () => {
	const divergent = await findDivergentDistFiles( 'deadbeef', {
		fetchImpl: async () => ( {
			ok: true,
			arrayBuffer: async () => new TextEncoder().encode( 'upstream' ).buffer,
		} ),
		readFileImpl: ( filePath ) => {
			const relativePath = DIST_FILES.find( ( file ) => filePath.endsWith( file ) );
			// Only the first file is stale.
			return Buffer.from( relativePath === DIST_FILES[ 0 ] ? 'vendored' : 'upstream' );
		},
	} );

	assert.deepEqual( divergent, [ DIST_FILES[ 0 ] ] );
} );

test( 'formatFailure names the recorded and latest revisions, the stale files, and the resync command', () => {
	const message = formatFailure( {
		recordedRevision: '6e8131f4fe45c6e4b7a89c72ced833a468058427',
		latestRevision: '73452e6a7a0299d2c20ac71d778483c8f1fd3e5a',
		divergentFiles: [ 'dist/capture-engine.bundle.mjs' ],
	} );

	assert.match( message, /6e8131f4fe45c6e4b7a89c72ced833a468058427/ );
	assert.match( message, /73452e6a7a0299d2c20ac71d778483c8f1fd3e5a/ );
	assert.match( message, /dist\/capture-engine\.bundle\.mjs/ );
	assert.match( message, /node scripts\/sync-data-liberation-agent\.mjs/ );
} );
