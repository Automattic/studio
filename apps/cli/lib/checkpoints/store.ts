import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'path';
import zlib from 'zlib';
import {
	getObjectsDirectory,
	getStoreTmpDirectory,
	type CheckpointManifest,
	type ObjectRef,
} from './manifest';

// Content-addressed object store: immutable file contents keyed by sha-256,
// fanned out into two-character subdirectories. Objects are written to tmp/
// and renamed into place, so a partial write is garbage, never corruption.

// File extensions whose contents compress well. Media and archives are stored
// raw so `copyFile` can use copy-on-write cloning where the filesystem
// supports it (APFS; NTFS/ext4 silently fall back to a real copy).
const COMPRESSIBLE_EXTENSIONS = new Set( [
	'.php',
	'.js',
	'.mjs',
	'.cjs',
	'.ts',
	'.css',
	'.scss',
	'.json',
	'.html',
	'.htm',
	'.svg',
	'.txt',
	'.md',
	'.sql',
	'.xml',
	'.yml',
	'.yaml',
	'.pot',
	'.po',
	'.sqlite',
	'.htaccess',
] );

export function shouldCompress( filePath: string ): boolean {
	const base = path.basename( filePath );
	if ( base.startsWith( '.ht' ) ) {
		// .htaccess and the SQLite database family compress well.
		return true;
	}
	return COMPRESSIBLE_EXTENSIONS.has( path.extname( filePath ).toLowerCase() );
}

export function getObjectPath( siteId: string, hash: string ): string {
	return path.join( getObjectsDirectory( siteId ), hash.slice( 0, 2 ), hash.slice( 2 ) );
}

export async function objectExists( siteId: string, hash: string ): Promise< boolean > {
	try {
		await fsPromises.access( getObjectPath( siteId, hash ) );
		return true;
	} catch ( error ) {
		return false;
	}
}

async function hashFile( sourcePath: string ): Promise< string > {
	const hash = crypto.createHash( 'sha256' );
	for await ( const chunk of fs.createReadStream( sourcePath ) ) {
		hash.update( chunk as Buffer );
	}
	return hash.digest( 'hex' );
}

// Stores a file's contents as an object, deduplicating against existing
// objects. Returns the object reference (content hash of the ORIGINAL bytes,
// stored size, and compression flag).
export async function writeObject(
	siteId: string,
	sourcePath: string,
	options: { compress?: boolean } = {}
): Promise< ObjectRef > {
	const compress = options.compress ?? shouldCompress( sourcePath );
	const hash = await hashFile( sourcePath );
	const objectPath = getObjectPath( siteId, hash );

	if ( await objectExists( siteId, hash ) ) {
		const { size } = await fsPromises.stat( objectPath );
		return { hash, size, z: compress };
	}

	await fsPromises.mkdir( path.dirname( objectPath ), { recursive: true } );
	const tmpPath = path.join(
		getStoreTmpDirectory( siteId ),
		`obj-${ process.pid }-${ crypto.randomUUID() }`
	);

	try {
		if ( compress ) {
			await pipeline(
				fs.createReadStream( sourcePath ),
				zlib.createGzip( { level: 6 } ),
				fs.createWriteStream( tmpPath )
			);
		} else {
			// COPYFILE_FICLONE clones on copy-on-write filesystems (APFS) and
			// silently falls back to a regular copy elsewhere.
			await fsPromises.copyFile( sourcePath, tmpPath, fs.constants.COPYFILE_FICLONE );
		}

		try {
			await fsPromises.rename( tmpPath, objectPath );
		} catch ( error ) {
			// A concurrent writer may have stored the same object first; content
			// addressing makes that outcome identical to ours.
			if ( ! ( await objectExists( siteId, hash ) ) ) {
				throw error;
			}
		}
	} finally {
		await fsPromises.rm( tmpPath, { force: true } );
	}

	const { size } = await fsPromises.stat( objectPath );
	return { hash, size, z: compress };
}

// Materializes an object's original bytes at `destinationPath`.
export async function readObjectToFile(
	siteId: string,
	ref: ObjectRef,
	destinationPath: string,
	options: { mode?: number } = {}
): Promise< void > {
	const objectPath = getObjectPath( siteId, ref.hash );
	await fsPromises.mkdir( path.dirname( destinationPath ), { recursive: true } );

	if ( ref.z ) {
		await pipeline(
			fs.createReadStream( objectPath ),
			zlib.createGunzip(),
			fs.createWriteStream( destinationPath )
		);
	} else {
		await fsPromises.copyFile( objectPath, destinationPath, fs.constants.COPYFILE_FICLONE );
	}

	if ( options.mode !== undefined && process.platform !== 'win32' ) {
		await fsPromises.chmod( destinationPath, options.mode );
	}
}

export function collectReferencedHashes( manifests: CheckpointManifest[] ): Set< string > {
	const referenced = new Set< string >();
	for ( const manifest of manifests ) {
		referenced.add( manifest.db.hash );
		for ( const entry of Object.values( manifest.files ) ) {
			if ( 'hash' in entry ) {
				referenced.add( entry.hash );
			}
		}
	}
	return referenced;
}

// Deletes objects referenced by no manifest. Only objects older than
// `graceMs` are eligible so an in-flight create's freshly written objects
// (whose manifest hasn't landed yet) are never swept. Runs lock-free — see
// the locking notes in manifest.ts.
export async function collectGarbage(
	siteId: string,
	referencedHashes: Set< string >,
	graceMs: number
): Promise< number > {
	const objectsDir = getObjectsDirectory( siteId );
	let removed = 0;
	let fanoutDirs: string[];
	try {
		fanoutDirs = await fsPromises.readdir( objectsDir );
	} catch ( error ) {
		return 0;
	}

	const now = Date.now();
	for ( const fanout of fanoutDirs ) {
		const fanoutPath = path.join( objectsDir, fanout );
		let entries: string[];
		try {
			entries = await fsPromises.readdir( fanoutPath );
		} catch ( error ) {
			continue;
		}
		for ( const entry of entries ) {
			const hash = `${ fanout }${ entry }`;
			if ( referencedHashes.has( hash ) ) {
				continue;
			}
			const objectPath = path.join( fanoutPath, entry );
			try {
				const { mtimeMs } = await fsPromises.stat( objectPath );
				if ( now - mtimeMs < graceMs ) {
					continue;
				}
				await fsPromises.rm( objectPath, { force: true } );
				removed++;
			} catch ( error ) {
				// Another process may have removed it; nothing to do.
			}
		}
	}

	// Clear stale tmp files from interrupted writes, with the same grace window.
	try {
		const tmpDir = getStoreTmpDirectory( siteId );
		for ( const entry of await fsPromises.readdir( tmpDir ) ) {
			const tmpPath = path.join( tmpDir, entry );
			try {
				const { mtimeMs } = await fsPromises.stat( tmpPath );
				if ( now - mtimeMs >= graceMs ) {
					await fsPromises.rm( tmpPath, { force: true, recursive: true } );
				}
			} catch ( error ) {
				// Ignore races with other cleaners.
			}
		}
	} catch ( error ) {
		// tmp dir may not exist yet.
	}

	return removed;
}
