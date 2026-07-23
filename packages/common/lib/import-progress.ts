import { __, sprintf } from '@wordpress/i18n';
import { BackupExtractEvents, ImporterEvents, type ImportEventTuple } from './import-export-events';

const WP_CONTENT_TYPE_LABELS: Record< string, string > = {
	plugins: __( 'Importing plugins…' ),
	themes: __( 'Importing themes…' ),
	uploads: __( 'Importing media uploads…' ),
	other: __( 'Importing other files…' ),
};

export function getImportStatusMessage( [ event, data ]: ImportEventTuple ): string | undefined {
	switch ( event ) {
		case BackupExtractEvents.BACKUP_EXTRACT_START:
			return __( 'Extracting backup files…' );
		case BackupExtractEvents.BACKUP_EXTRACT_PROGRESS:
			if (
				data.processedFiles !== undefined &&
				data.totalFiles !== undefined &&
				data.totalFiles > 0
			) {
				return sprintf(
					__( 'Extracting backup… (%d%%)' ),
					Math.round( ( data.processedFiles / data.totalFiles ) * 100 )
				);
			}
			return __( 'Extracting backup files…' );
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
					__( 'Importing database… (%d%%)' ),
					Math.round( ( data.processedFiles / data.totalFiles ) * 100 )
				);
			}
			return __( 'Importing database…' );
		case ImporterEvents.IMPORT_WP_CONTENT_START:
			return __( 'Importing WordPress content…' );
		case ImporterEvents.IMPORT_WP_CONTENT_PROGRESS:
			if (
				data.type &&
				data.processedItems !== undefined &&
				data.totalItems !== undefined &&
				data.totalItems > 0
			) {
				return sprintf(
					__( '%1$s (%2$d%%)' ),
					WP_CONTENT_TYPE_LABELS[ data.type ] || __( 'Importing files…' ),
					Math.round( ( data.processedItems / data.totalItems ) * 100 )
				);
			}
			return __( 'Importing WordPress content…' );
		case ImporterEvents.IMPORT_COMPLETE:
			return __( 'Importing completed' );
	}
}
