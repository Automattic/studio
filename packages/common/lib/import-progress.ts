import { __, sprintf } from '@wordpress/i18n';
import { BackupExtractEvents, ImporterEvents, type ImportEventTuple } from './import-export-events';

// These land in a toast pinned to the sidebar, which is only 240px wide at its
// narrowest — roughly 166px of text. Anything longer wraps to a second line, so
// the messages that carry a percentage drop the verb to make room for it.
const getWpContentTypeLabels = (): Record< string, string > => ( {
	plugins: __( 'Plugins…' ),
	themes: __( 'Themes…' ),
	uploads: __( 'Media uploads…' ),
	other: __( 'Other files…' ),
} );

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
				return sprintf(
					__( 'Extracting… (%d%%)' ),
					Math.round( ( data.processedFiles / data.totalFiles ) * 100 )
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
				return sprintf(
					__( 'Database… (%d%%)' ),
					Math.round( ( data.processedFiles / data.totalFiles ) * 100 )
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
				return sprintf(
					__( '%1$s (%2$d%%)' ),
					getWpContentTypeLabels()[ data.type ] || __( 'Files…' ),
					Math.round( ( data.processedItems / data.totalItems ) * 100 )
				);
			}
			return __( 'Importing content…' );
		case ImporterEvents.IMPORT_COMPLETE:
			return __( 'Importing completed' );
	}
}
