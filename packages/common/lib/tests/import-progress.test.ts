import { describe, expect, it } from 'vitest';
import { BackupExtractEvents, ImporterEvents } from '../import-export-events';
import { getImportStatusMessage } from '../import-progress';
import type { ImportEventTuple } from '../import-export-events';

describe( 'getImportStatusMessage', () => {
	it( 'formats extraction progress', () => {
		expect(
			getImportStatusMessage( [
				BackupExtractEvents.BACKUP_EXTRACT_PROGRESS,
				{ processedFiles: 1, totalFiles: 4 },
			] )
		).toBe( 'Extracting… (25%)' );
	} );

	it( 'formats database progress', () => {
		expect(
			getImportStatusMessage( [
				ImporterEvents.IMPORT_DATABASE_PROGRESS,
				{ processedFiles: 3, totalFiles: 4 },
			] )
		).toBe( 'Database… (75%)' );
	} );

	it( 'formats WordPress content progress by type', () => {
		expect(
			getImportStatusMessage( [
				ImporterEvents.IMPORT_WP_CONTENT_PROGRESS,
				{ type: 'uploads', processedItems: 1, totalItems: 2 },
			] )
		).toBe( 'Media uploads… (50%)' );
	} );

	// The sidebar toast is 240px at its narrowest, leaving ~166px of text before
	// the title wraps to a second line — about 30 characters at 13px.
	it( 'keeps every status message short enough for one line in the toast', () => {
		const progress = { processedFiles: 1, totalFiles: 3 };
		const events: ImportEventTuple[] = [
			[ BackupExtractEvents.BACKUP_EXTRACT_START, undefined ],
			[ BackupExtractEvents.BACKUP_EXTRACT_PROGRESS, progress ],
			[ ImporterEvents.IMPORT_START, 'jetpack' ],
			[ ImporterEvents.IMPORT_DATABASE_START, undefined ],
			[ ImporterEvents.IMPORT_DATABASE_PROGRESS, progress ],
			[ ImporterEvents.IMPORT_WP_CONTENT_START, undefined ],
			[ ImporterEvents.IMPORT_COMPLETE, 'jetpack' ],
			...( [ 'plugins', 'themes', 'uploads', 'other', 'unknown' ].map( ( type ) => [
				ImporterEvents.IMPORT_WP_CONTENT_PROGRESS,
				{ type, processedItems: 1, totalItems: 3 },
			] ) as ImportEventTuple[] ),
		];

		for ( const event of events ) {
			const message = getImportStatusMessage( event );
			expect( message ).toBeDefined();
			expect( message!.length ).toBeLessThanOrEqual( 30 );
		}
	} );

	it( 'ignores events that do not change the status message', () => {
		expect(
			getImportStatusMessage( [ ImporterEvents.IMPORT_DATABASE_COMPLETE, undefined ] )
		).toBeUndefined();
	} );
} );
