import { z } from 'zod';
import { getErrorMessage } from './error-formatting';

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

const importerTypeSchema = z.union( [
	z.literal( 'jetpack' ),
	z.literal( 'local' ),
	z.literal( 'playground' ),
	z.literal( 'sql' ),
	z.literal( 'wpress' ),
	z.literal( 'xml' ),
] );

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

const nullOrUndefined = z.union( [ z.undefined(), z.null() ] );

export const importEventTupleSchema = z.union( [
	z.tuple( [
		z.literal( BackupExtractEvents.BACKUP_EXTRACT_START ),
		backupExtractProgressEventDataSchema.or( nullOrUndefined ),
	] ),
	z.tuple( [
		z.literal( BackupExtractEvents.BACKUP_EXTRACT_PROGRESS ),
		backupExtractProgressEventDataSchema,
	] ),
	z.tuple( [
		z.literal( BackupExtractEvents.BACKUP_EXTRACT_FILE_START ),
		backupExtractProgressEventDataSchema,
	] ),
	z.tuple( [
		z.literal( BackupExtractEvents.BACKUP_EXTRACT_COMPLETE ),
		backupExtractProgressEventDataSchema.or( nullOrUndefined ),
	] ),
	z.tuple( [ z.literal( BackupExtractEvents.BACKUP_EXTRACT_WARNING ), z.string() ] ),
	z.tuple( [ z.literal( BackupExtractEvents.BACKUP_EXTRACT_ERROR ), z.unknown() ] ),
	z.tuple( [ z.literal( ValidatorEvents.IMPORT_VALIDATION_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ValidatorEvents.IMPORT_VALIDATION_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ValidatorEvents.IMPORT_VALIDATION_ERROR ), z.unknown() ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_START ), importerTypeSchema ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_DATABASE_START ), nullOrUndefined ] ),
	z.tuple( [
		z.literal( ImporterEvents.IMPORT_DATABASE_PROGRESS ),
		importDatabaseProgressEventDataSchema,
	] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_DATABASE_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_WP_CONTENT_START ), nullOrUndefined ] ),
	z.tuple( [
		z.literal( ImporterEvents.IMPORT_WP_CONTENT_PROGRESS ),
		importWpContentProgressEventDataSchema,
	] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_WP_CONTENT_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_META_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_META_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_COMPLETE ), importerTypeSchema ] ),
	z.tuple( [ z.literal( ImporterEvents.IMPORT_ERROR ), z.string() ] ),
] );

export const importIpcEventSchema = z.object( { event: importEventTupleSchema } );

export type ImporterType = z.infer< typeof importerTypeSchema >;
export type ImportEventTuple = z.infer< typeof importEventTupleSchema >;
export type ImportIpcEvent = z.infer< typeof importIpcEventSchema >;

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

export const exportErrorPayloadSchema = z.object( {
	code: z.literal( 'export_failed' ),
	message: z.string().optional(),
} );

type ExportErrorPayload = z.infer< typeof exportErrorPayloadSchema >;

export function createExportErrorPayload( error: unknown ): ExportErrorPayload {
	const message = getErrorMessage( error );
	return { code: 'export_failed', message };
}

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

export const exportEventTupleSchema = z.union( [
	z.tuple( [ z.literal( ExportEvents.EXPORT_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.EXPORT_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.EXPORT_ERROR ), exportErrorPayloadSchema ] ),
	z.tuple( [ z.literal( ExportEvents.BACKUP_CREATE_START ), nullOrUndefined ] ),
	z.tuple( [
		z.literal( ExportEvents.BACKUP_CREATE_PROGRESS ),
		backupCreateProgressEventDataSchema,
	] ),
	z.tuple( [ z.literal( ExportEvents.BACKUP_CREATE_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.WP_CONTENT_EXPORT_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.WP_CONTENT_EXPORT_PROGRESS ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.WP_CONTENT_EXPORT_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.DATABASE_EXPORT_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.DATABASE_EXPORT_PROGRESS ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.DATABASE_EXPORT_COMPLETE ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.CONFIG_EXPORT_START ), nullOrUndefined ] ),
	z.tuple( [ z.literal( ExportEvents.CONFIG_EXPORT_COMPLETE ), nullOrUndefined ] ),
] );

export const exportIpcEventSchema = z.object( { event: exportEventTupleSchema } );

export type ExportEventTuple = z.infer< typeof exportEventTupleSchema >;
export type ExportIpcEvent = z.infer< typeof exportIpcEventSchema >;
