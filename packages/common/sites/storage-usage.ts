import { promises as fs } from 'fs';
import path from 'path';

// What a WordPress install's disk footprint is actually made of. Everything
// outside the named buckets (core files, drop-ins, stray folders) lands in
// `other`, so the parts always add up to `total`.
export interface SiteStorageUsage {
	total: number;
	uploads: number;
	plugins: number;
	themes: number;
	database: number;
	other: number;
}

type StorageBucket = Exclude< keyof SiteStorageUsage, 'total' >;

// Relative paths whose contents belong to a bucket. Longest match wins, so
// `wp-content/database` doesn't get swallowed by a broader rule.
const BUCKET_PATHS: [ string, StorageBucket ][] = [
	[ 'wp-content/uploads', 'uploads' ],
	[ 'wp-content/plugins', 'plugins' ],
	[ 'wp-content/themes', 'themes' ],
	// Studio's SQLite database lives here (`.ht.sqlite` and its journals).
	[ 'wp-content/database', 'database' ],
];

const EMPTY_USAGE: SiteStorageUsage = {
	total: 0,
	uploads: 0,
	plugins: 0,
	themes: 0,
	database: 0,
	other: 0,
};

/**
 * Measure a site folder's disk usage, split into the buckets a site owner
 * actually recognizes (media, plugins, themes, database, everything else).
 *
 * One traversal, classifying each file by the path it sits under. Symlinks are
 * not followed and unreadable entries are skipped rather than failing the
 * measurement — a partial number beats an error for something this cosmetic.
 */
export async function measureSiteStorage( sitePath: string ): Promise< SiteStorageUsage > {
	const usage: SiteStorageUsage = { ...EMPTY_USAGE };

	async function walk( directory: string ): Promise< void > {
		let entries;
		try {
			entries = await fs.readdir( directory, { withFileTypes: true } );
		} catch {
			return;
		}

		await Promise.all(
			entries.map( async ( entry ) => {
				const entryPath = path.join( directory, entry.name );
				if ( entry.isSymbolicLink() ) {
					return;
				}
				if ( entry.isDirectory() ) {
					await walk( entryPath );
					return;
				}
				if ( ! entry.isFile() ) {
					return;
				}
				try {
					const { size } = await fs.stat( entryPath );
					usage.total += size;
					usage[ bucketFor( path.relative( sitePath, entryPath ) ) ] += size;
				} catch {
					// Vanished or unreadable between readdir and stat.
				}
			} )
		);
	}

	await walk( sitePath );
	return usage;
}

function bucketFor( relativePath: string ): StorageBucket {
	const normalized = relativePath.split( path.sep ).join( '/' );
	for ( const [ prefix, bucket ] of BUCKET_PATHS ) {
		if ( normalized.startsWith( `${ prefix }/` ) ) {
			return bucket;
		}
	}
	return 'other';
}
