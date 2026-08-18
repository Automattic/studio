import fs from 'node:fs/promises';
import path from 'node:path';

export interface SiteStorageUsage {
	total: number;
	uploads: number;
	plugins: number;
	themes: number;
	database: number;
	other: number;
}

type StorageCategory = Exclude< keyof SiteStorageUsage, 'total' >;

const MAX_CONCURRENT_STATS = 32;
const CATEGORY_DIRECTORIES: Array< [ string, StorageCategory ] > = [
	[ path.join( 'wp-content', 'uploads' ), 'uploads' ],
	[ path.join( 'wp-content', 'plugins' ), 'plugins' ],
	[ path.join( 'wp-content', 'themes' ), 'themes' ],
	[ path.join( 'wp-content', 'database' ), 'database' ],
];

function getCategory( relativePath: string ): StorageCategory {
	const match = CATEGORY_DIRECTORIES.find(
		( [ directory ] ) =>
			relativePath === directory || relativePath.startsWith( `${ directory }${ path.sep }` )
	);
	return match?.[ 1 ] ?? 'other';
}

export async function measureSiteStorage( sitePath: string ): Promise< SiteStorageUsage > {
	const usage: SiteStorageUsage = {
		total: 0,
		uploads: 0,
		plugins: 0,
		themes: 0,
		database: 0,
		other: 0,
	};
	const directories = [ sitePath ];
	const files: Array< { path: string; category: StorageCategory } > = [];

	for ( let index = 0; index < directories.length; index++ ) {
		const directory = directories[ index ];
		let entries;
		try {
			entries = await fs.readdir( directory, { withFileTypes: true } );
		} catch {
			continue;
		}

		for ( const entry of entries ) {
			const entryPath = path.join( directory, entry.name );
			if ( entry.isDirectory() ) {
				directories.push( entryPath );
			} else if ( entry.isFile() ) {
				files.push( {
					path: entryPath,
					category: getCategory( path.relative( sitePath, entryPath ) ),
				} );
			}
		}
	}

	let nextFile = 0;
	async function measureNextFile(): Promise< void > {
		while ( nextFile < files.length ) {
			const file = files[ nextFile++ ];
			try {
				const stats = await fs.stat( file.path );
				usage.total += stats.size;
				usage[ file.category ] += stats.size;
			} catch {
				// Files can disappear or become unreadable while a site is running.
			}
		}
	}

	await Promise.all(
		Array.from( { length: Math.min( MAX_CONCURRENT_STATS, files.length ) }, () =>
			measureNextFile()
		)
	);

	return usage;
}
