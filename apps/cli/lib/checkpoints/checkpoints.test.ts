import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	checkpointIndexSchema,
	checkpointManifestSchema,
	readCheckpointIndex,
	updateCheckpointIndex,
	ensureStoreDirectories,
	getObjectsDirectory,
	CHECKPOINT_STORE_VERSION,
	type CheckpointManifest,
} from './manifest';
import { DEFAULT_RETENTION_POLICY, selectPrunableCheckpoints } from './retention';
import {
	collectGarbage,
	collectReferencedHashes,
	getObjectPath,
	readObjectToFile,
	shouldCompress,
	writeObject,
} from './store';
import { canReusePreviousEntry, walkSite } from './walker';

const SITE_ID = 'test-site';
let tmpDir: string;

beforeEach( async () => {
	tmpDir = await fsPromises.mkdtemp( path.join( os.tmpdir(), 'studio-checkpoints-test-' ) );
	process.env.DEV_CONFIG_DIR = tmpDir;
	await ensureStoreDirectories( SITE_ID );
} );

afterEach( async () => {
	delete process.env.DEV_CONFIG_DIR;
	await fsPromises.rm( tmpDir, { recursive: true, force: true } );
} );

async function writeSourceFile( name: string, contents: string ): Promise< string > {
	const filePath = path.join( tmpDir, name );
	await fsPromises.mkdir( path.dirname( filePath ), { recursive: true } );
	await fsPromises.writeFile( filePath, contents );
	return filePath;
}

function makeManifest( overrides: Partial< CheckpointManifest > = {} ): CheckpointManifest {
	return checkpointManifestSchema.parse( {
		version: CHECKPOINT_STORE_VERSION,
		id: overrides.id ?? 'cp-test',
		siteId: SITE_ID,
		createdAt: Date.now(),
		trigger: 'manual',
		db: { hash: 'db-hash', size: 1, z: true, capture: 'file-copy' },
		files: {},
		stats: { fileCount: 0, logicalBytes: 0, newObjectBytes: 0 },
		...overrides,
	} );
}

describe( 'store', () => {
	it( 'stores and round-trips compressed and raw objects', async () => {
		const phpSource = await writeSourceFile( 'src/sample.php', '<?php echo "hello";' );
		const compressed = await writeObject( SITE_ID, phpSource );
		expect( compressed.z ).toBe( true );

		const binarySource = await writeSourceFile( 'src/image.jpg', 'JPEGDATA' );
		const raw = await writeObject( SITE_ID, binarySource );
		expect( raw.z ).toBe( false );

		const restoredPhp = path.join( tmpDir, 'restored.php' );
		await readObjectToFile( SITE_ID, compressed, restoredPhp );
		expect( await fsPromises.readFile( restoredPhp, 'utf8' ) ).toBe( '<?php echo "hello";' );

		const restoredJpg = path.join( tmpDir, 'restored.jpg' );
		await readObjectToFile( SITE_ID, raw, restoredJpg );
		expect( await fsPromises.readFile( restoredJpg, 'utf8' ) ).toBe( 'JPEGDATA' );
	} );

	it( 'deduplicates identical content', async () => {
		const first = await writeObject( SITE_ID, await writeSourceFile( 'a.php', 'same' ) );
		const second = await writeObject( SITE_ID, await writeSourceFile( 'b.php', 'same' ) );
		expect( second.hash ).toBe( first.hash );

		const objectsDir = getObjectsDirectory( SITE_ID );
		const fanouts = await fsPromises.readdir( objectsDir );
		let objectCount = 0;
		for ( const fanout of fanouts ) {
			objectCount += ( await fsPromises.readdir( path.join( objectsDir, fanout ) ) ).length;
		}
		expect( objectCount ).toBe( 1 );
	} );

	it( 'hashes original bytes, not compressed bytes', async () => {
		const source = await writeSourceFile( 'c.php', 'content-for-hash' );
		const asCompressed = await writeObject( SITE_ID, source, { compress: true } );
		// Same content stored raw in a fresh store dir must produce the same hash.
		const rawStoreId = 'other-site';
		await ensureStoreDirectories( rawStoreId );
		const asRaw = await writeObject( rawStoreId, source, { compress: false } );
		expect( asRaw.hash ).toBe( asCompressed.hash );
	} );

	it( 'garbage collects unreferenced objects but honors the grace window', async () => {
		const keep = await writeObject( SITE_ID, await writeSourceFile( 'keep.php', 'keep' ) );
		const drop = await writeObject( SITE_ID, await writeSourceFile( 'drop.php', 'drop' ) );

		const manifest = makeManifest( {
			files: {
				'keep.php': { ...keep, mode: 0o644, mtimeMs: 1, logicalSize: 4 },
			},
			db: { ...keep, capture: 'file-copy' },
		} );
		const referenced = collectReferencedHashes( [ manifest ] );

		// Inside the grace window nothing is swept.
		expect( await collectGarbage( SITE_ID, referenced, 60_000 ) ).toBe( 0 );
		expect( fs.existsSync( getObjectPath( SITE_ID, drop.hash ) ) ).toBe( true );

		// With no grace, the unreferenced object goes and the referenced stays.
		expect( await collectGarbage( SITE_ID, referenced, 0 ) ).toBe( 1 );
		expect( fs.existsSync( getObjectPath( SITE_ID, drop.hash ) ) ).toBe( false );
		expect( fs.existsSync( getObjectPath( SITE_ID, keep.hash ) ) ).toBe( true );
	} );

	it( 'keeps objects shared across manifests while any manifest references them', async () => {
		const shared = await writeObject( SITE_ID, await writeSourceFile( 'shared.php', 'shared' ) );
		const manifestA = makeManifest( { id: 'cp-a', db: { ...shared, capture: 'file-copy' } } );
		const referenced = collectReferencedHashes( [ manifestA ] );
		await collectGarbage( SITE_ID, referenced, 0 );
		expect( fs.existsSync( getObjectPath( SITE_ID, shared.hash ) ) ).toBe( true );
	} );

	it( 'compresses by extension policy', () => {
		expect( shouldCompress( 'x/y/file.php' ) ).toBe( true );
		expect( shouldCompress( 'x/.htaccess' ) ).toBe( true );
		expect( shouldCompress( 'wp-content/database/.ht.sqlite' ) ).toBe( true );
		expect( shouldCompress( 'x/photo.jpg' ) ).toBe( false );
		expect( shouldCompress( 'x/archive.zip' ) ).toBe( false );
	} );
} );

describe( 'walker', () => {
	async function makeSite(): Promise< string > {
		const sitePath = path.join( tmpDir, 'site' );
		await fsPromises.mkdir( path.join( sitePath, 'wp-content', 'plugins', 'demo' ), {
			recursive: true,
		} );
		await fsPromises.mkdir( path.join( sitePath, 'wp-content', 'database' ), { recursive: true } );
		await fsPromises.mkdir( path.join( sitePath, 'node_modules', 'junk' ), { recursive: true } );
		await fsPromises.writeFile( path.join( sitePath, 'wp-config.php' ), '<?php // config' );
		await fsPromises.writeFile(
			path.join( sitePath, 'wp-content', 'plugins', 'demo', 'demo.php' ),
			'<?php // demo'
		);
		await fsPromises.writeFile(
			path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' ),
			'FAKE-DB'
		);
		await fsPromises.writeFile( path.join( sitePath, 'wp-content', 'db.php' ), '<?php // dropin' );
		await fsPromises.writeFile( path.join( sitePath, 'node_modules', 'junk', 'x.js' ), 'excluded' );
		await fsPromises.writeFile(
			path.join( sitePath, '.studio-checkpoint-db-temp.sqlite' ),
			'temp'
		);
		return sitePath;
	}

	it( 'excludes the database dir, db.php, node_modules, and checkpoint temp files', async () => {
		const sitePath = await makeSite();
		const walk = await walkSite( sitePath );
		const paths = walk.files.map( ( file ) => file.relPath );
		expect( paths ).toContain( 'wp-config.php' );
		expect( paths ).toContain( 'wp-content/plugins/demo/demo.php' );
		expect( paths ).not.toContain( 'wp-content/database/.ht.sqlite' );
		expect( paths ).not.toContain( 'wp-content/db.php' );
		expect( paths.some( ( p ) => p.startsWith( 'node_modules' ) ) ).toBe( false );
		expect( paths.some( ( p ) => p.includes( '.studio-checkpoint-' ) ) ).toBe( false );
	} );

	it( 'records symlinks without following them', async () => {
		const sitePath = await makeSite();
		const linkPath = path.join( sitePath, 'wp-content', 'plugins', 'linked' );
		await fsPromises.symlink( '../themes', linkPath );
		const walk = await walkSite( sitePath );
		expect( walk.symlinks ).toContainEqual( {
			relPath: 'wp-content/plugins/linked',
			target: '../themes',
		} );
	} );

	it( 'reuses previous entries only when size and mtime match', async () => {
		const sitePath = await makeSite();
		const walk = await walkSite( sitePath );
		const demo = walk.files.find( ( file ) => file.relPath.endsWith( 'demo.php' ) )!;

		const previous = makeManifest( {
			files: {
				[ demo.relPath ]: {
					hash: 'previous-hash',
					size: 10,
					z: true,
					mode: demo.mode,
					mtimeMs: demo.mtimeMs,
					logicalSize: demo.size,
				},
			},
		} );

		expect( canReusePreviousEntry( demo, previous )?.hash ).toBe( 'previous-hash' );
		expect( canReusePreviousEntry( { ...demo, size: demo.size + 1 }, previous ) ).toBeUndefined();
		expect(
			canReusePreviousEntry( { ...demo, mtimeMs: demo.mtimeMs + 1 }, previous )
		).toBeUndefined();
		expect( canReusePreviousEntry( demo, undefined ) ).toBeUndefined();
	} );
} );

describe( 'retention', () => {
	function indexWith( triggers: Array< [ string, string, boolean? ] > ) {
		return checkpointIndexSchema.parse( {
			version: CHECKPOINT_STORE_VERSION,
			checkpoints: triggers.map( ( [ id, trigger, pinned ], position ) => ( {
				id,
				createdAt: position,
				trigger,
				pinned,
				stats: { fileCount: 0, logicalBytes: 0, newObjectBytes: 0 },
			} ) ),
		} );
	}

	it( 'never prunes manual or agent checkpoints', () => {
		const index = indexWith( [
			...Array.from( { length: 30 }, ( _, i ): [ string, string ] => [ `m${ i }`, 'manual' ] ),
			...Array.from( { length: 30 }, ( _, i ): [ string, string ] => [ `a${ i }`, 'agent' ] ),
		] );
		expect( selectPrunableCheckpoints( index, DEFAULT_RETENTION_POLICY ) ).toHaveLength( 0 );
	} );

	it( 'prunes oldest auto checkpoints beyond the cap', () => {
		const index = indexWith(
			Array.from( { length: 13 }, ( _, i ): [ string, string ] => [
				`auto${ i }`,
				'auto-pre-tool',
			] )
		);
		const prunable = selectPrunableCheckpoints( index, DEFAULT_RETENTION_POLICY );
		expect( prunable.map( ( entry ) => entry.id ) ).toEqual( [ 'auto0', 'auto1', 'auto2' ] );
	} );

	it( 'never prunes pinned checkpoints', () => {
		const index = indexWith(
			Array.from( { length: 13 }, ( _, i ): [ string, string, boolean ] => [
				`auto${ i }`,
				'auto-pre-tool',
				i === 0,
			] )
		);
		const prunable = selectPrunableCheckpoints( index, DEFAULT_RETENTION_POLICY );
		expect( prunable.map( ( entry ) => entry.id ) ).toEqual( [ 'auto1', 'auto2' ] );
	} );
} );

describe( 'index', () => {
	it( 'returns an empty index when none exists', async () => {
		const index = await readCheckpointIndex( SITE_ID );
		expect( index.checkpoints ).toEqual( [] );
	} );

	it( 'persists mutations through updateCheckpointIndex', async () => {
		await updateCheckpointIndex( SITE_ID, ( index ) => {
			index.checkpoints.push( {
				id: 'cp-1',
				createdAt: 1,
				trigger: 'manual',
				stats: { fileCount: 0, logicalBytes: 0, newObjectBytes: 0 },
			} );
			return index;
		} );
		const index = await readCheckpointIndex( SITE_ID );
		expect( index.checkpoints.map( ( entry ) => entry.id ) ).toEqual( [ 'cp-1' ] );
	} );

	it( 'rejects indexes written by a newer format version', async () => {
		await updateCheckpointIndex( SITE_ID, ( index ) => index );
		const indexPath = path.join( tmpDir, 'checkpoints', SITE_ID, 'index.json' );
		await fsPromises.writeFile(
			indexPath,
			JSON.stringify( { version: CHECKPOINT_STORE_VERSION + 1, checkpoints: [] } )
		);
		await expect( readCheckpointIndex( SITE_ID ) ).rejects.toThrow( /newer version/ );
	} );
} );
