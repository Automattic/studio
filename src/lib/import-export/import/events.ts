export const HandlerEvents = {
	BACKUP_HANDLER_START: 'handler_start',
	BACKUP_HANDLER_PROGRESS: 'handler_progress',
	BACKUP_HANDLER_COMPLETE: 'handler_complete',
	BACKUP_HANDLER_ERROR: 'handler_error',
} as const;

export const ValidatorEvents = {
	IMPORT_VALIDATION_START: 'import_validation_start',
	IMPORT_VALIDATION_COMPLETE: 'import_validation_complete',
	IMPORT_VALIDATION_ERROR: 'import_validation_error',
} as const;

export const ImporterEvents = {
	IMPORT_START: 'import_start',
	IMPORT_DATABASE_START: 'import_database_start',
	IMPORT_DATABASE_COMPLETE: 'import_database_complete',
	IMPORT_WP_CONTENT_START: 'import_wp_content_start',
	IMPORT_WP_CONTENT_COMPLETE: 'import_wp_content_complete',
	IMPORT_META_START: 'import_meta',
	IMPORT_META_COMPLETE: 'import_meta_complete',
	IMPORT_COMPLETE: 'import_complete',
	IMPORT_ERROR: 'import_error',
} as const;

export const ImportEvents = {
	...HandlerEvents,
	...ValidatorEvents,
	...ImporterEvents,
} as const;

export type ImportEventType = ( typeof ImportEvents )[ keyof typeof ImportEvents ];
