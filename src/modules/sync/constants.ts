export const GRANULAR_SYNC_FOLDERS = [ 'plugins', 'themes', 'uploads' ] as const;

export const SYNC_EXCLUSIONS = [
	'database',
	'db.php',
	'debug.log',
	'sqlite-database-integration',
	'.DS_Store',
	'Thumbs.db',
];

export type SyncExclusion = ( typeof SYNC_EXCLUSIONS )[ number ];
