import { z } from 'zod';

export const BackupExtractEvents = {
	BACKUP_EXTRACT_START: 'backup_extract_start',
	BACKUP_EXTRACT_PROGRESS: 'backup_extract_progress',
	BACKUP_EXTRACT_FILE_START: 'backup_extract_file_start',
	BACKUP_EXTRACT_COMPLETE: 'backup_extract_complete',
	BACKUP_EXTRACT_WARNING: 'backup_extract_warning',
	BACKUP_EXTRACT_ERROR: 'backup_extract_error',
} as const;

export const ValidatorEvents = {
	IMPORT_VALIDATION_START: 'import_validation_start',
	IMPORT_VALIDATION_COMPLETE: 'import_validation_complete',
	IMPORT_VALIDATION_ERROR: 'import_validation_error',
} as const;

export const ImporterEvents = {
	IMPORT_START: 'import_start',
	IMPORT_DATABASE_START: 'import_database_start',
	IMPORT_DATABASE_PROGRESS: 'import_database_progress',
	IMPORT_DATABASE_COMPLETE: 'import_database_complete',
	IMPORT_WP_CONTENT_START: 'import_wp_content_start',
	IMPORT_WP_CONTENT_PROGRESS: 'import_wp_content_progress',
	IMPORT_WP_CONTENT_COMPLETE: 'import_wp_content_complete',
	IMPORT_META_START: 'import_meta',
	IMPORT_META_COMPLETE: 'import_meta_complete',
	IMPORT_COMPLETE: 'import_complete',
	IMPORT_ERROR: 'import_error',
} as const;

export const ImportEvents = {
	...BackupExtractEvents,
	...ValidatorEvents,
	...ImporterEvents,
} as const;

export const backupExtractProgressEventDataSchema = z.object( {
	progress: z.number().optional(),
	processedFiles: z.number().optional(),
	totalFiles: z.number().optional(),
	currentFile: z.string().optional(),
	extractedBytes: z.number().optional(),
	totalBytes: z.number().optional(),
} );

export const importDatabaseProgressEventDataSchema = z.object( {
	currentTable: z.string().optional(),
	processedTables: z.number().optional(),
	totalTables: z.number().optional(),
	currentFile: z.string().optional(),
	processedFiles: z.number().optional(),
	totalFiles: z.number().optional(),
} );

export const importWpContentProgressEventDataSchema = z.object( {
	type: z.enum( [ 'plugins', 'themes', 'uploads', 'other' ] ).optional(),
	currentItem: z.string().optional(),
	processedItems: z.number().optional(),
	totalItems: z.number().optional(),
	processedBytes: z.number().optional(),
	totalBytes: z.number().optional(),
} );

export const importEventDataMapSchema = z.object( {
	[ BackupExtractEvents.BACKUP_EXTRACT_START ]: backupExtractProgressEventDataSchema.optional(),
	[ BackupExtractEvents.BACKUP_EXTRACT_PROGRESS ]: backupExtractProgressEventDataSchema,
	[ BackupExtractEvents.BACKUP_EXTRACT_FILE_START ]: backupExtractProgressEventDataSchema,
	[ BackupExtractEvents.BACKUP_EXTRACT_COMPLETE ]: backupExtractProgressEventDataSchema.optional(),
	[ BackupExtractEvents.BACKUP_EXTRACT_WARNING ]: z.string(),
	[ BackupExtractEvents.BACKUP_EXTRACT_ERROR ]: z.unknown(),
	[ ValidatorEvents.IMPORT_VALIDATION_START ]: z.undefined(),
	[ ValidatorEvents.IMPORT_VALIDATION_COMPLETE ]: z.undefined(),
	[ ValidatorEvents.IMPORT_VALIDATION_ERROR ]: z.unknown(),
	[ ImporterEvents.IMPORT_START ]: z.undefined(),
	[ ImporterEvents.IMPORT_DATABASE_START ]: z.undefined(),
	[ ImporterEvents.IMPORT_DATABASE_PROGRESS ]: importDatabaseProgressEventDataSchema,
	[ ImporterEvents.IMPORT_DATABASE_COMPLETE ]: z.undefined(),
	[ ImporterEvents.IMPORT_WP_CONTENT_START ]: z.undefined(),
	[ ImporterEvents.IMPORT_WP_CONTENT_PROGRESS ]: importWpContentProgressEventDataSchema,
	[ ImporterEvents.IMPORT_WP_CONTENT_COMPLETE ]: z.undefined(),
	[ ImporterEvents.IMPORT_META_START ]: z.undefined(),
	[ ImporterEvents.IMPORT_META_COMPLETE ]: z.undefined(),
	[ ImporterEvents.IMPORT_COMPLETE ]: z.undefined(),
	[ ImporterEvents.IMPORT_ERROR ]: z.unknown(),
} );

type ImportEventType = ( typeof ImportEvents )[ keyof typeof ImportEvents ];
type ImportEventDataMap = z.infer< typeof importEventDataMapSchema >;

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

const backupCreateProgressEventDataSchema = z.object( {
	// This schema is derived from the `archiver.ProgressData` type
	progress: z.object( {
		entries: z.object( {
			total: z.number(),
			processed: z.number(),
		} ),
		fs: z.object( {
			totalBytes: z.number(),
			processedBytes: z.number(),
		} ),
	} ),
} );

export const exportEventDataMapSchema = z.object( {
	[ ExportEvents.EXPORT_START ]: z.undefined(),
	[ ExportEvents.EXPORT_COMPLETE ]: z.undefined(),
	[ ExportEvents.EXPORT_ERROR ]: z.unknown().nullable(),
	[ ExportEvents.BACKUP_CREATE_START ]: z.undefined(),
	[ ExportEvents.BACKUP_CREATE_PROGRESS ]: backupCreateProgressEventDataSchema,
	[ ExportEvents.BACKUP_CREATE_COMPLETE ]: z.undefined(),
	[ ExportEvents.WP_CONTENT_EXPORT_START ]: z.undefined(),
	[ ExportEvents.WP_CONTENT_EXPORT_PROGRESS ]: z.undefined(),
	[ ExportEvents.WP_CONTENT_EXPORT_COMPLETE ]: z.undefined(),
	[ ExportEvents.DATABASE_EXPORT_START ]: z.undefined(),
	[ ExportEvents.DATABASE_EXPORT_PROGRESS ]: z.undefined(),
	[ ExportEvents.DATABASE_EXPORT_COMPLETE ]: z.undefined(),
	[ ExportEvents.CONFIG_EXPORT_START ]: z.undefined(),
	[ ExportEvents.CONFIG_EXPORT_COMPLETE ]: z.undefined(),
} );

type ExportEventType = ( typeof ExportEvents )[ keyof typeof ExportEvents ];
type ExportEventDataMap = z.infer< typeof exportEventDataMapSchema >;

export type ImportExportEventType = ImportEventType | ExportEventType;
export type ImportExportEventDataMap = ImportEventDataMap & ExportEventDataMap;
