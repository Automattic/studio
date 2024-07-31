export const ExportEvents = {
	EXPORT_START: 'export_start',
	EXPORT_COMPLETE: 'export_complete',
	EXPORT_ERROR: 'export_error',
	BACKUP_CREATE_START: 'backup_create_start',
	BACKUP_CREATE_PROGRESS: 'backup_create_progress',
	BACKUP_CREATE_COMPLETE: 'backup_create_complete',
	WP_CONTENT_EXPORT_START: 'wp_content_export_start',
	WP_CONTENT_EXPORT_PROGRESS: 'wp_content_export_progress',
	WP_CONTENT_EXPORT_COMPLETE: 'wp_content_export_complete',
	DATABASE_EXPORT_START: 'database_export_start',
	DATABASE_EXPORT_PROGRESS: 'database_export_progress',
	DATABASE_EXPORT_COMPLETE: 'database_export_complete',
	CONFIG_EXPORT_START: 'config_export_start',
	CONFIG_EXPORT_COMPLETE: 'config_export_complete',
} as const;

export type ExportEventType = ( typeof ExportEvents )[ keyof typeof ExportEvents ];
