import { __, sprintf } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';
import { useState } from 'react';
import { useDeleteSite } from '@/data/queries/use-sites';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

interface DeleteSiteDialogProps {
	site: SiteDetails;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onDeleted?: () => void;
}

export function DeleteSiteDialog( { site, open, onOpenChange, onDeleted }: DeleteSiteDialogProps ) {
	const deleteSite = useDeleteSite();
	const [ deleteFiles, setDeleteFiles ] = useState( true );

	const handleConfirm = async () => {
		try {
			await deleteSite.mutateAsync( { id: site.id, deleteFiles } );
			onDeleted?.();
		} catch ( err ) {
			return {
				error: ( err as Error )?.message || __( 'Unable to delete the site. Please try again.' ),
			};
		}
	};

	return (
		<AlertDialog.Root open={ open } onOpenChange={ onOpenChange } onConfirm={ handleConfirm }>
			<AlertDialog.Popup
				intent="irreversible"
				title={ sprintf( __( 'Delete %s' ), site.name ) }
				description={ __(
					"The site's database will be lost, including all posts, pages, comments, and media."
				) }
				confirmButtonText={ __( 'Delete site' ) }
			>
				<label className={ styles.dialogCheckbox }>
					<input
						type="checkbox"
						checked={ deleteFiles }
						onChange={ ( event ) => setDeleteFiles( event.target.checked ) }
					/>
					<span>{ __( 'Delete site files from my computer' ) }</span>
				</label>
			</AlertDialog.Popup>
		</AlertDialog.Root>
	);
}
