// Splits the node_modules folders of the workspace into shards of about the same number of files,
// so that CI can archive and extract them in parallel, and puts them back afterwards.
// Each shard holds a marker file, so that a restore can tell whether every shard came back.
//
// Usage:
//   node .buildkite/commands/node-modules-shards.mjs stage <staging folder> <shard count>
//   node .buildkite/commands/node-modules-shards.mjs unstage <staging folder>
//   node .buildkite/commands/node-modules-shards.mjs check <shard count>

import fs from 'node:fs';
import path from 'node:path';

const [ action, ...args ] = process.argv.slice( 2 );

const markerPath = ( shard ) => path.join( 'node_modules', `.ci-cache-shard-${ shard }` );

function nodeModulesFolders() {
	const folders = fs.existsSync( 'node_modules' ) ? [ 'node_modules' ] : [];
	for ( const parent of [ 'apps', 'packages', 'tools' ] ) {
		for ( const name of fs.readdirSync( parent ) ) {
			const folder = path.join( parent, name, 'node_modules' );
			if ( fs.existsSync( folder ) ) {
				folders.push( folder );
			}
		}
	}
	return folders;
}

function countEntries( entryPath, dirent ) {
	if ( ! dirent.isDirectory() ) {
		return 1;
	}
	let count = 1;
	for ( const child of fs.readdirSync( entryPath, { withFileTypes: true } ) ) {
		count += countEntries( path.join( entryPath, child.name ), child );
	}
	return count;
}

function stage( stagingFolder, shardCount ) {
	const entries = nodeModulesFolders().flatMap( ( folder ) =>
		fs.readdirSync( folder, { withFileTypes: true } ).map( ( dirent ) => {
			const entryPath = path.join( folder, dirent.name );
			return { entryPath, size: countEntries( entryPath, dirent ) };
		} )
	);

	// Largest first, each into the shard with the fewest files so far.
	const loads = new Array( shardCount ).fill( 0 );
	const moves = [];
	for ( const { entryPath, size } of entries.sort( ( a, b ) => b.size - a.size ) ) {
		const shard = loads.indexOf( Math.min( ...loads ) );
		loads[ shard ] += size;
		moves.push( [ entryPath, path.join( stagingFolder, String( shard ), entryPath ) ] );
	}

	for ( const [ from, to ] of moves ) {
		fs.mkdirSync( path.dirname( to ), { recursive: true } );
		fs.renameSync( from, to );
	}
	for ( let shard = 0; shard < shardCount; shard++ ) {
		const marker = path.join( stagingFolder, String( shard ), markerPath( shard ) );
		fs.mkdirSync( path.dirname( marker ), { recursive: true } );
		fs.writeFileSync( marker, '' );
	}
	fs.writeFileSync( path.join( stagingFolder, 'moves.json' ), JSON.stringify( moves ) );
	console.log( `Files and folders per shard: ${ loads.join( ', ' ) }` );
}

function unstage( stagingFolder ) {
	const moves = JSON.parse( fs.readFileSync( path.join( stagingFolder, 'moves.json' ), 'utf8' ) );
	for ( const [ from, to ] of moves ) {
		fs.renameSync( to, from );
	}
}

// Exits with 0 when every shard was restored, and removes the markers.
function check( shardCount ) {
	let complete = true;
	for ( let shard = 0; shard < shardCount; shard++ ) {
		if ( fs.existsSync( markerPath( shard ) ) ) {
			fs.rmSync( markerPath( shard ) );
		} else {
			complete = false;
		}
	}
	process.exit( complete ? 0 : 1 );
}

if ( action === 'stage' ) {
	stage( args[ 0 ], Number( args[ 1 ] ) );
} else if ( action === 'unstage' ) {
	unstage( args[ 0 ] );
} else if ( action === 'check' ) {
	check( Number( args[ 0 ] ) );
} else {
	throw new Error( 'Usage: node-modules-shards.mjs stage <folder> <count> | unstage <folder> | check <count>' );
}
