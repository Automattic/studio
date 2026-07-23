import { describe, expect, it } from 'vitest';
import { BackupExtractEvents, ImporterEvents } from '../import-export-events';
import { getImportStatusMessage } from '../import-progress';

describe( 'getImportStatusMessage', () => {
	it( 'formats extraction progress', () => {
		expect(
			getImportStatusMessage( [
				BackupExtractEvents.BACKUP_EXTRACT_PROGRESS,
				{ processedFiles: 1, totalFiles: 4 },
			] )
		).toBe( 'Extracting backup… (25%)' );
	} );

	it( 'formats database progress', () => {
		expect(
			getImportStatusMessage( [
				ImporterEvents.IMPORT_DATABASE_PROGRESS,
				{ processedFiles: 3, totalFiles: 4 },
			] )
		).toBe( 'Importing database… (75%)' );
	} );

	it( 'formats WordPress content progress by type', () => {
		expect(
			getImportStatusMessage( [
				ImporterEvents.IMPORT_WP_CONTENT_PROGRESS,
				{ type: 'uploads', processedItems: 1, totalItems: 2 },
			] )
		).toBe( 'Importing media uploads… (50%)' );
	} );

	it( 'ignores events that do not change the status message', () => {
		expect(
			getImportStatusMessage( [ ImporterEvents.IMPORT_DATABASE_COMPLETE, undefined ] )
		).toBeUndefined();
	} );
} );
