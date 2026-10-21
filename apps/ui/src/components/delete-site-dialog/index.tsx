import { CheckboxControl } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { AlertDialog } from '@wordpress/ui';
import { useState } from 'react';
import { AppThemeScope } from '@/components/app-theme-scope';
import { useDeleteSite } from '@/data/queries/use-sites';
import { useConfirmOnEnter } from '@/hooks/use-confirm-on-enter';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

interface DeleteSiteDialogProps {
	sites: SiteDetails[];
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
	onDeleted?: () => void;
}

export function DeleteSiteDialog( {
	sites,
	open,
	onOpenChange,
	onDeleted,
}: DeleteSiteDialogProps ) {
	const deleteSite = useDeleteSite();
	const [ deleteFiles, setDeleteFiles ] = useState( true );
	const count = sites.length;
	const confirmLabel = _n( 'Delete site', 'Delete sites', count );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );

	// One at a time, so a failure leaves the rest deleted and is reported.
	const handleConfirm = async () => {
		const errors: string[] = [];
		for ( const site of sites ) {
			try {
				await deleteSite.mutateAsync( { id: site.id, deleteFiles } );
			} catch ( err ) {
				errors.push( ( err as Error )?.message );
			}
		}
		if ( errors.length < count ) {
			onDeleted?.();
		}
		if ( errors.length ) {
			const reason = errors.find( Boolean ) ?? __( 'Unable to delete the site. Please try again.' );
			return {
				error:
					count === 1
						? reason
						: sprintf(
								/* translators: 1: sites deleted, 2: sites selected, 3: sites that failed, 4: the first error. */
								__( '%1$d of %2$d sites deleted. %3$d failed: %4$s' ),
								count - errors.length,
								count,
								errors.length,
								reason
						  ),
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
					onKeyDown={ handleKeyDown }
					intent="irreversible"
					title={
						count === 1
							? sprintf( __( 'Delete %s' ), sites[ 0 ].name )
							: sprintf(
									/* translators: %d: number of sites. */
									_n( 'Delete %d site', 'Delete %d sites', count ),
									count
							  )
					}
					description={
						count === 1
							? __(
									"The site's database will be lost, including all posts, pages, comments, and media."
							  )
							: __(
									"These sites' databases will be lost, including all their posts, pages, comments, and media."
							  )
					}
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
