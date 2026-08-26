import { CheckboxControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';
import { useState } from 'react';
import { AppThemeScope } from '@/components/app-theme-scope';
import { useDeleteSite } from '@/data/queries/use-sites';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
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
	const confirmLabel = __( 'Delete site' );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );

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
		// The dialog is opened from the site list, which lives in the sidebar's
		// dark chrome scope; without this it inherits that palette and renders
		// dark on top of the light app.
		<AppThemeScope>
			<AlertDialog.Root open={ open } onOpenChange={ onOpenChange } onConfirm={ handleConfirm }>
				<AlertDialog.Popup
					className={ styles.popup }
					onKeyDown={ handleKeyDown }
					intent="irreversible"
					title={ sprintf( __( 'Delete %s' ), site.name ) }
					description={ __(
						"The site's database will be lost, including all posts, pages, comments, and media."
					) }
					confirmButtonText={ confirmLabel }
				>
					<div className={ styles.dialogCheckbox }>
						<CheckboxControl
							__nextHasNoMarginBottom
							label={ __( 'Delete site files from my computer' ) }
							checked={ deleteFiles }
							onChange={ setDeleteFiles }
						/>
					</div>
				</AlertDialog.Popup>
			</AlertDialog.Root>
		</AppThemeScope>
	);
}
