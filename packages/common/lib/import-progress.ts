import { __, sprintf } from '@wordpress/i18n';
import { BackupExtractEvents, ImporterEvents, type ImportEventTuple } from './import-export-events';

// These land in a toast pinned to the sidebar, which is only 240px wide at its
// narrowest — roughly 166px of text — so the messages carrying a percentage drop
// the verb to make room for it and lead with the number, the part that actually
// changes. A longer translation may wrap to a second line; what it must not do
// is reflow on every tick, so the percentage is padded to a fixed two digits.
const getWpContentTypeLabels = (): Record< string, string > => ( {
	plugins: __( 'Plugins…' ),
	themes: __( 'Themes…' ),
	uploads: __( 'Media uploads…' ),
	other: __( 'Other files…' ),
} );

// `@wordpress/i18n`'s sprintf ignores width flags like `%02d`, so pad here and
// interpolate as a string.
const percent = ( done: number, total: number ): string =>
	String( Math.round( ( done / total ) * 100 ) ).padStart( 2, '0' );

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
					/* translators: %s: percentage complete, zero-padded to two digits. */
					__( '%s%% · Extracting…' ),
					percent( data.processedFiles, data.totalFiles )
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
					/* translators: %s: percentage complete, zero-padded to two digits. */
					__( '%s%% · Database…' ),
					percent( data.processedFiles, data.totalFiles )
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
					/* translators: %1$s: percentage complete, zero-padded to two digits. %2$s: what is being imported. */
					__( '%1$s%% · %2$s' ),
					percent( data.processedItems, data.totalItems ),
					getWpContentTypeLabels()[ data.type ] || __( 'Files…' )
				);
			}
			return __( 'Importing content…' );
		case ImporterEvents.IMPORT_COMPLETE:
			return __( 'Importing completed' );
	}
}
