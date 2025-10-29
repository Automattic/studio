export const GRANULAR_SYNC_FOLDERS = [
	'plugins',
	'themes',
	'uploads',
	'mu-plugins',
	'fonts',
] as const;

export const SYNC_EXCLUSIONS = [
	'database',
	'database/',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'sqlite-database-integration/',
	'.DS_Store',
	'Thumbs.db',
];

export type SyncExclusion = ( typeof SYNC_EXCLUSIONS )[ number ];
