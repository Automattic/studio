import { __ } from '@wordpress/i18n';
import { BackupExtractEvents, ImporterEvents, type ImportEventTuple } from './import-export-events';
import { formatProgressLabel } from './progress-label';

// These land in a per-site activity row that is only ~166px wide at the
// narrowest sidebar, so the labels that carry a percentage drop the verb to
// make room for it. `formatProgressLabel` handles the leading, zero-padded
// number that keeps the width steady as the import ticks.
const getWpContentTypeLabels = (): Record< string, string > => ( {
	plugins: __( 'Plugins…' ),
	themes: __( 'Themes…' ),
	uploads: __( 'Media uploads…' ),
	other: __( 'Other files…' ),
} );

const percentOf = ( done: number, total: number ) => ( done / total ) * 100;

export function getImportStatusMessage( [ event, data ]: ImportEventTuple ): string | undefined {
	switch ( event ) {
		case BackupExtractEvents.BACKUP_EXTRACT_START:
			return __( 'Extracting backup…' );
		case BackupExtractEvents.BACKUP_EXTRACT_PROGRESS:
			if (
				data.processedFiles !== undefined &&
				data.totalFiles !== undefined &&
				data.totalFiles > 0
			) {
				return formatProgressLabel(
					__( 'Extracting…' ),
					percentOf( data.processedFiles, data.totalFiles )
				);
			}
			return __( 'Extracting backup…' );
		case ImporterEvents.IMPORT_START:
			return __( 'Importing backup…' );
		case ImporterEvents.IMPORT_DATABASE_START:
			return __( 'Importing database…' );
		case ImporterEvents.IMPORT_DATABASE_PROGRESS:
			if (
				data.processedFiles !== undefined &&
				data.totalFiles !== undefined &&
				data.totalFiles > 0
			) {
				return formatProgressLabel(
					__( 'Database…' ),
					percentOf( data.processedFiles, data.totalFiles )
				);
			}
			return __( 'Importing database…' );
		case ImporterEvents.IMPORT_WP_CONTENT_START:
			return __( 'Importing content…' );
		case ImporterEvents.IMPORT_WP_CONTENT_PROGRESS:
			if (
				data.type &&
				data.processedItems !== undefined &&
				data.totalItems !== undefined &&
				data.totalItems > 0
			) {
				return formatProgressLabel(
					getWpContentTypeLabels()[ data.type ] || __( 'Files…' ),
					percentOf( data.processedItems, data.totalItems )
				);
			}
			return __( 'Importing content…' );
		case ImporterEvents.IMPORT_COMPLETE:
			return __( 'Importing completed' );
	}
}
