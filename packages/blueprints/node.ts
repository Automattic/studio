import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { __, sprintf } from '@wordpress/i18n';
import yauzl from 'yauzl';
import { fetchLibraryBlueprints, type LibraryBlueprint } from './library';
import { validateBlueprint, type Blueprint } from './validate';

export interface OpenedBlueprint extends AsyncDisposable {
	blueprint: Blueprint;
	// Its blueprint.json on disk, with any files its steps use beside it.
	path: string;
}

// Library slugs have no path separator or extension, so a missing `site.json` still reports
// the missing file.
const SLUG_PATTERN = /^[\w-]+$/;

/**
 * Opens a Blueprint from a URL, a .json file, a folder holding a blueprint.json, a .zip bundle,
 * a Library slug, or a Library entry, and checks it. Anything it unpacks is removed when the
 * result is disposed, so open it with `await using`.
 */
export async function openBlueprint(
	source: string | LibraryBlueprint,
	{ locale }: { locale?: string } = {}
): Promise< OpenedBlueprint > {
	if ( typeof source !== 'string' ) {
		return openLibraryBlueprint( source );
	}
	if ( /^https?:\/\//i.test( source ) ) {
		return openUrl( source );
	}

	const filePath = path.resolve( source );
	if ( fs.existsSync( filePath ) ) {
		return openBlueprintFile( filePath );
	}
	if ( ! SLUG_PATTERN.test( source ) ) {
		throw new Error( sprintf( __( 'Blueprint file not found: %s' ), filePath ) );
	}
	const entry = ( await fetchLibraryBlueprints( { locale } ) ).find( ( bp ) => bp.slug === source );
	if ( ! entry ) {
		throw new Error(
			sprintf(
				/* translators: %s: the value given as a Blueprint */
				__( '"%s" is not a Blueprint file, URL or Library slug.' ),
				source
			)
		);
	}
	return openLibraryBlueprint( entry );
}

async function openLibraryBlueprint( entry: LibraryBlueprint ): Promise< OpenedBlueprint > {
	if ( entry.bundleUrl ) {
		return openUrl( entry.bundleUrl );
	}
	return inTempDir( async ( tempDir ) => {
		const filePath = path.join( tempDir, 'blueprint.json' );
		await fs.promises.writeFile( filePath, JSON.stringify( entry.blueprint ) );
		return { blueprint: validateBlueprint( entry.blueprint ), path: filePath };
	} );
}

async function openUrl( url: string ): Promise< OpenedBlueprint > {
	const response = await fetch( url );
	if ( ! response.ok ) {
		throw new Error( sprintf( __( 'Failed to fetch Blueprint: HTTP %d' ), response.status ) );
	}
	const contents = Buffer.from( await response.arrayBuffer() );
	if ( isZip( contents ) ) {
		return openZip( contents );
	}
	return inTempDir( async ( tempDir ) => {
		const filePath = path.join( tempDir, 'blueprint.json' );
		await fs.promises.writeFile( filePath, contents );
		return { blueprint: parseBlueprint( contents.toString( 'utf8' ) ), path: filePath };
	} );
}

/**
 * Opens a Blueprint from a local .json file, a folder holding a blueprint.json, or a .zip bundle,
 * without reaching the network. Use it for paths a user picked or uploaded.
 */
export async function openBlueprintFile( filePath: string ): Promise< OpenedBlueprint > {
	if ( ( await fs.promises.stat( filePath ) ).isDirectory() ) {
		return openFile( path.join( filePath, 'blueprint.json' ) );
	}
	const contents = await fs.promises.readFile( filePath );
	if ( isZip( contents ) ) {
		return openZip( contents );
	}
	return { blueprint: parseBlueprint( contents.toString( 'utf8' ) ), path: filePath, ...noCleanup };
}

async function openFile( filePath: string ): Promise< OpenedBlueprint > {
	const contents = await fs.promises.readFile( filePath, 'utf8' );
	return { blueprint: parseBlueprint( contents ), path: filePath, ...noCleanup };
}

function openZip( contents: Buffer ): Promise< OpenedBlueprint > {
	return inTempDir( async ( tempDir ) => {
		await extractZip( contents, tempDir ).catch( () => {
			throw new Error( __( 'This ZIP could not be read. Check that it is a valid zip file.' ) );
		} );
		const opened = await openFile( await findBlueprintInBundle( tempDir ) );
		return { blueprint: opened.blueprint, path: opened.path };
	} );
}

// Every zip starts with a `PK` record signature, which no JSON document can.
function isZip( contents: Buffer ): boolean {
	return contents.subarray( 0, 2 ).toString( 'latin1' ) === 'PK';
}

function parseBlueprint( contents: string ): Blueprint {
	let data: unknown;
	try {
		data = JSON.parse( contents );
	} catch {
		throw new Error(
			__(
				'This Blueprint JSON file could not be read. Check that it contains valid JSON and try again.'
			)
		);
	}
	return validateBlueprint( data );
}

const noCleanup = { [ Symbol.asyncDispose ]: async () => {} };

async function inTempDir(
	open: ( tempDir: string ) => Promise< Omit< OpenedBlueprint, typeof Symbol.asyncDispose > >
): Promise< OpenedBlueprint > {
	const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-blueprint-' ) );
	const remove = () => fs.promises.rm( tempDir, { recursive: true, force: true } );
	try {
		return { ...( await open( tempDir ) ), [ Symbol.asyncDispose ]: remove };
	} catch ( error ) {
		await remove();
		throw error;
	}
}

// A bundle holds its blueprint.json at the root or inside one enclosing folder.
async function findBlueprintInBundle( directory: string ): Promise< string > {
	const candidates = [
		'blueprint.json',
		...( await fs.promises.readdir( directory, { withFileTypes: true } ) )
			.filter( ( entry ) => entry.isDirectory() && entry.name !== '__MACOSX' )
			.map( ( entry ) => path.join( entry.name, 'blueprint.json' ) ),
	].filter( ( candidate ) => fs.existsSync( path.join( directory, candidate ) ) );

	if ( candidates[ 0 ] === 'blueprint.json' ) {
		return path.join( directory, 'blueprint.json' );
	}
	if ( candidates.length !== 1 ) {
		throw new Error(
			candidates.length > 1
				? 'Multiple Blueprints found in the ZIP. Include only one Blueprint bundle.'
				: 'No blueprint.json found in the ZIP. Place it at the root or inside one enclosing folder.'
		);
	}
	return path.join( directory, candidates[ 0 ] );
}

// yauzl rejects entries with absolute paths or `..` segments, so nothing lands outside `directory`.
async function extractZip( contents: Buffer, directory: string ): Promise< void > {
	const zip = await promisify< Buffer, yauzl.Options, yauzl.ZipFile >( yauzl.fromBuffer )(
		contents,
		{ lazyEntries: true }
	);
	const openReadStream = promisify( zip.openReadStream.bind( zip ) );
	await new Promise< void >( ( resolve, reject ) => {
		zip.on( 'error', reject );
		zip.on( 'end', resolve );
		zip.on( 'entry', ( entry: yauzl.Entry ) => {
			if ( entry.fileName.endsWith( '/' ) ) {
				zip.readEntry();
				return;
			}
			const target = path.join( directory, entry.fileName );
			fs.promises
				.mkdir( path.dirname( target ), { recursive: true } )
				.then( () => openReadStream( entry ) )
				.then( ( stream ) => pipeline( stream, fs.createWriteStream( target ) ) )
				.then( () => zip.readEntry(), reject );
		} );
		zip.readEntry();
	} );
}
