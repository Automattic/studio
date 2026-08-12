import { ACCEPTED_IMPORT_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { getImportStatusMessage } from '@studio/common/lib/import-progress';
import { useMutationState } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';
import { useState } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { IMPORT_SITE_MUTATION_KEY, useImportSite } from '@/data/queries/use-import-site';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';
import type { ImportSiteInput } from '@/data/queries/use-import-site';

export const IMPORT_FILE_ACCEPT = ACCEPTED_IMPORT_FILE_TYPES.join( ',' );

// A quiet stretch between progress events shouldn't drop the toast mid-import,
// and `confirm` always clears it explicitly once the import settles.
const PROGRESS_TOAST_TTL_MS = 10 * 60 * 1000;

// `confirming` is tracked alongside the file rather than derived from it because
// the popup stays mounted through its closing animation — dropping the file to
// close would shrink the dialog mid-fade.
interface PendingImport {
	siteId: string;
	file: File;
	confirming: boolean;
}

export function useSiteBackupImport( site: SiteDetails ) {
	const connector = useConnector();
	const importSite = useImportSite();
	// Everything here is stamped with a site id: the overview stays mounted when
	// the user switches sites (the route only swaps the `$siteId` param), so a
	// plain boolean would follow them and light up the next site's Import button.
	const [ pending, setPending ] = useState< PendingImport | null >( null );
	// Covers the upload that resolves the backup path, before the mutation — and
	// so before `useMutationState` can see it.
	const [ preparingSiteId, setPreparingSiteId ] = useState< string | null >( null );

	// Read from the mutation cache rather than local state so the progress
	// survives navigating away, and so an import started during onboarding is
	// visible here too.
	const importingSiteIds = useMutationState( {
		filters: { mutationKey: IMPORT_SITE_MUTATION_KEY, status: 'pending' },
		select: ( mutation ) => ( mutation.state.variables as ImportSiteInput | undefined )?.siteId,
	} );

	const active = pending?.siteId === site.id ? pending : null;
	const isImporting = preparingSiteId === site.id || importingSiteIds.includes( site.id );

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
		setPending( { siteId: site.id, file: picked, confirming: true } );
	};

	const closeDialog = () =>
		setPending( ( current ) =>
			current?.siteId === site.id ? { ...current, confirming: false } : current
		);

	const confirm = async () => {
		const file = active?.file;
		if ( ! file || isImporting ) {
			return;
		}
		const { id: siteId } = site;
		closeDialog();
		setPreparingSiteId( siteId );
		const toastId = `import-site-${ siteId }`;
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
				siteId,
				backupPath,
				onProgress: ( event ) => {
					const message = getImportStatusMessage( event );
					if ( message && message !== lastMessage ) {
						lastMessage = message;
						toast.info( message, {
							id: toastId,
							durationMs: PROGRESS_TOAST_TTL_MS,
							singleLine: true,
						} );
					}
				},
			} );
		} catch ( error ) {
			toast.error( __( 'Import failed' ), { description: getErrorMessage( error ) } );
		} finally {
			dismissToast( toastId );
			setPreparingSiteId( ( current ) => ( current === siteId ? null : current ) );
			// Drop the File so a large backup isn't held in memory for the session.
			setPending( ( current ) => ( current?.siteId === siteId ? null : current ) );
		}
	};

	return {
		file: active?.file ?? null,
		isConfirming: active?.confirming ?? false,
		selectFile,
		cancel: closeDialog,
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
