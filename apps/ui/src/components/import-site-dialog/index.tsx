import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { getImportStatusMessage } from '@studio/common/lib/import-progress';
import { __, sprintf } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';
import { useState } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useImportSite } from '@/data/queries/use-import-site';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export const IMPORT_FILE_ACCEPT = ACCEPTED_IMPORT_FILE_TYPES.join( ',' );

// A quiet stretch between progress events shouldn't drop the toast mid-import,
// and `confirm` always clears it explicitly once the import settles.
const PROGRESS_TOAST_TTL_MS = 10 * 60 * 1000;

export function useSiteBackupImport( site: SiteDetails ) {
	const connector = useConnector();
	const importSite = useImportSite();
	const [ file, setFile ] = useState< File | null >( null );
	// Tracked separately from `file` because the popup stays mounted through its
	// closing animation — clearing the file to close would shrink it mid-fade.
	const [ isConfirming, setIsConfirming ] = useState( false );
	const [ isImporting, setIsImporting ] = useState( false );

	const selectFile = ( picked?: File ) => {
		if ( ! picked ) {
			return;
		}
		// The input's `accept` filter is advisory — a drag or an "All files"
		// pick can still hand us something unsupported.
		if ( ! isSupportedBackupFilename( picked.name ) ) {
			toast.error(
				__(
					'This file type is not supported. Please use a .zip, .gz, .gzip, .tar, .tar.gz, .wpress, .sql, or .xml file.'
				)
			);
			return;
		}
		setFile( picked );
		setIsConfirming( true );
	};

	const confirm = async () => {
		if ( ! file || isImporting ) {
			return;
		}
		setIsConfirming( false );
		setIsImporting( true );
		const toastId = `import-site-${ site.id }`;
		// Extraction reports progress once per stream chunk, so a large backup
		// fires thousands of events a second. Only re-show the toast when the
		// rendered text actually changes — otherwise the store notifies its
		// subscribers that fast and the app stops responding to clicks.
		let lastMessage = '';
		try {
			const backupPath = await connector.getFilePath( file );
			if ( ! backupPath ) {
				throw new Error( __( 'Unable to access the selected backup. Please try again.' ) );
			}
			await importSite.mutateAsync( {
				siteId: site.id,
				backupPath,
				onProgress: ( event ) => {
					const message = getImportStatusMessage( event );
					if ( message && message !== lastMessage ) {
						lastMessage = message;
						toast.info( message, { id: toastId, durationMs: PROGRESS_TOAST_TTL_MS } );
					}
				},
			} );
		} catch ( error ) {
			toast.error( __( 'Import failed' ), { description: getErrorMessage( error ) } );
		} finally {
			dismissToast( toastId );
			setIsImporting( false );
		}
	};

	return {
		file,
		isConfirming,
		selectFile,
		cancel: () => setIsConfirming( false ),
		confirm,
		isImporting,
	};
}

interface ImportSiteDialogProps {
	site: SiteDetails;
	file: File | null;
	open: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

export function ImportSiteDialog( {
	site,
	file,
	open,
	onCancel,
	onConfirm,
}: ImportSiteDialogProps ) {
	return (
		<AlertDialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onCancel();
				}
			} }
			// Returns synchronously so the dialog closes and the import runs in the
			// background — an async handler would hold it open for the whole import.
			onConfirm={ onConfirm }
		>
			{ /* Deliberately not `intent="irreversible"`: the importer moves the site's
			     existing wp-content and database to the trash, not straight to deletion. */ }
			<AlertDialog.Popup
				title={ sprintf( __( 'Overwrite %s?' ), site.name ) }
				description={ __(
					'Importing a backup will replace the existing files and database for your site.'
				) }
				confirmButtonText={ __( 'Import' ) }
			>
				{ file ? <p className={ styles.fileName }>{ file.name }</p> : null }
			</AlertDialog.Popup>
		</AlertDialog.Root>
	);
}
