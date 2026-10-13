/**
 * Shrinks a bundled node_modules tree without changing what any `require` resolves to.
 *
 * Packages that ship an `npm-shrinkwrap.json` (e.g. @earendil-works/pi-coding-agent) get a
 * private, nested copy of their whole dependency tree, even where the top-level copy is the
 * same version, and npm ignores the `os`/`cpu` fields of shrinkwrapped optional dependencies,
 * so native binaries for every platform get installed. `npm dedupe` leaves shrinkwrapped
 * subtrees alone, so this script:
 *
 * - removes a nested package when the copy Node would resolve without it (the nearest one in
 *   an ancestor node_modules, within the tree) has the same name and version;
 * - removes packages whose `os` excludes the target platform, or whose `cpu` excludes the
 *   target arch. Arch is only checked when `--arch` is passed: macOS builds of the other
 *   arch run install:bundle on the build machine's arch.
 *
 * Usage: node prune-bundled-node-modules.mjs [node_modules dir] [--platform <p>] [--arch <a>]
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { parseArgs } from 'util';

function readManifest( packageDir ) {
	try {
		return JSON.parse( fs.readFileSync( path.join( packageDir, 'package.json' ), 'utf8' ) );
	} catch {
		return null;
	}
}

function listPackages( nodeModulesDir ) {
	const names = [];
	for ( const entry of fs.readdirSync( nodeModulesDir, { withFileTypes: true } ) ) {
		if ( entry.name.startsWith( '.' ) || ! entry.isDirectory() ) {
			continue;
		}
		if ( entry.name.startsWith( '@' ) ) {
			for ( const scoped of fs.readdirSync( path.join( nodeModulesDir, entry.name ), {
				withFileTypes: true,
			} ) ) {
				if ( scoped.isDirectory() ) {
					names.push( `${ entry.name }/${ scoped.name }` );
				}
			}
		} else {
			names.push( entry.name );
		}
	}
	return names;
}

// Same semantics as npm's `os`/`cpu` checks: a list of allowed values and/or `!`-negations.
function allows( list, value ) {
	if ( ! Array.isArray( list ) || list.length === 0 ) {
		return true;
	}
	if ( list.includes( `!${ value }` ) ) {
		return false;
	}
	const allowed = list.filter( ( item ) => ! item.startsWith( '!' ) );
	return allowed.length === 0 || allowed.includes( value );
}

function isRedundant( name, manifest, ancestors ) {
	for ( const ancestor of ancestors ) {
		const resolved = readManifest( path.join( ancestor, name ) );
		if ( resolved ) {
			return resolved.name === manifest.name && resolved.version === manifest.version;
		}
	}
	return false;
}

function sizeOf( target ) {
	const stat = fs.lstatSync( target );
	if ( ! stat.isDirectory() ) {
		return stat.size;
	}
	return fs
		.readdirSync( target )
		.reduce( ( total, entry ) => total + sizeOf( path.join( target, entry ) ), 0 );
}

function removeDanglingBinLinks( nodeModulesDir ) {
	const binDir = path.join( nodeModulesDir, '.bin' );
	if ( ! fs.existsSync( binDir ) ) {
		return;
	}
	for ( const entry of fs.readdirSync( binDir ) ) {
		const link = path.join( binDir, entry );
		if ( fs.lstatSync( link ).isSymbolicLink() && ! fs.existsSync( link ) ) {
			fs.unlinkSync( link );
		}
	}
}

export function pruneNodeModules( rootDir, { platform = process.platform, arch } = {} ) {
	const removed = { count: 0, bytes: 0 };

	function remove( packageDir ) {
		removed.bytes += sizeOf( packageDir );
		removed.count++;
		fs.rmSync( packageDir, { recursive: true, force: true } );
		const parent = path.dirname( packageDir );
		if ( path.basename( parent ).startsWith( '@' ) && fs.readdirSync( parent ).length === 0 ) {
			fs.rmdirSync( parent );
		}
	}

	// `ancestors` are the node_modules dirs Node searches after `nodeModulesDir`, nearest first.
	function prune( nodeModulesDir, ancestors ) {
		for ( const name of listPackages( nodeModulesDir ) ) {
			const packageDir = path.join( nodeModulesDir, name );
			const manifest = readManifest( packageDir );
			if ( ! manifest ) {
				continue;
			}
			if (
				! allows( manifest.os, platform ) ||
				( arch && ! allows( manifest.cpu, arch ) ) ||
				isRedundant( name, manifest, ancestors )
			) {
				remove( packageDir );
				continue;
			}
			const nested = path.join( packageDir, 'node_modules' );
			if ( fs.existsSync( nested ) ) {
				prune( nested, [ nodeModulesDir, ...ancestors ] );
				removeDanglingBinLinks( nested );
			}
		}
	}

	prune( rootDir, [] );
	removeDanglingBinLinks( rootDir );
	return removed;
}

if ( process.argv[ 1 ] && import.meta.url === pathToFileURL( process.argv[ 1 ] ).href ) {
	const { values, positionals } = parseArgs( {
		allowPositionals: true,
		options: { platform: { type: 'string' }, arch: { type: 'string' } },
	} );
	const rootDir = path.resolve( positionals[ 0 ] ?? 'node_modules' );
	const { count, bytes } = pruneNodeModules( rootDir, values );
	console.log(
		`Pruned ${ count } redundant or other-platform packages from ${ rootDir } (${ (
			bytes /
			1024 /
			1024
		).toFixed( 1 ) } MB)`
	);
}
