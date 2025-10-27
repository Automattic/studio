export const GRANULAR_SYNC_FOLDERS = [
	'plugins',
	'themes',
	'uploads',
	'mu-plugins',
	'fonts',
] as const;

// Files and directories to exclude from sync display and operations
export const SYNC_EXCLUSIONS = [
	// System directories
	'database',
	'database/',
	// System files
	'db.php',
	'debug.log',
	// Studio-specific exclusions
	'sqlite-database-integration',
	'sqlite-database-integration/',
	// Cache and temporary files
	'.DS_Store',
	'Thumbs.db',
	// Hidden files/directories (handled separately with startsWith('.'))
];

export type SyncExclusion = ( typeof SYNC_EXCLUSIONS )[ number ];
