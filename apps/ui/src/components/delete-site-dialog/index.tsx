import { __, sprintf } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { useState } from 'react';
import { useDeleteSite } from '@/data/queries/use-sites';
import { removePluginSiteTag, usePluginSiteTag } from '@/lib/plugin-prototype';
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
	// Prototype: plugin sites get honest copy — deleting removes the plugin's
	// underlying site too.
	const pluginTag = usePluginSiteTag( site.id );
	const [ deleteFiles, setDeleteFiles ] = useState( true );
	const [ error, setError ] = useState< string | null >( null );

	const handleConfirm = () => {
		setError( null );
		deleteSite.mutate(
			{ id: site.id, deleteFiles },
			{
				onSuccess: () => {
					removePluginSiteTag( site.id );
					onOpenChange( false );
					onDeleted?.();
				},
				onError: ( err: Error ) => {
					setError( err.message ?? __( 'Unable to delete the site. Please try again.' ) );
				},
			}
		);
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( deleteSite.isPending ) {
					return;
				}
				onOpenChange( next );
				if ( ! next ) {
					setError( null );
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ sprintf( __( 'Delete %s' ), site.name ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<p className={ styles.dialogText }>
						{ pluginTag
							? __(
									"This deletes the plugin along with its test site — the site's database, posts, pages, comments, and media will be lost."
							  )
							: __(
									"The site's database will be lost, including all posts, pages, comments, and media."
							  ) }
					</p>
					<label className={ styles.dialogCheckbox }>
						<input
							type="checkbox"
							checked={ deleteFiles }
							onChange={ ( event ) => setDeleteFiles( event.target.checked ) }
						/>
						<span>{ __( 'Delete site files from my computer' ) }</span>
					</label>
					{ error ? <div className={ styles.dialogError }>{ error }</div> : null }
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral" disabled={ deleteSite.isPending }>
						{ __( 'Cancel' ) }
					</Dialog.Action>
					<Button
						variant="solid"
						tone="brand"
						loading={ deleteSite.isPending }
						loadingAnnouncement={ pluginTag ? __( 'Deleting plugin' ) : __( 'Deleting site' ) }
						onClick={ handleConfirm }
					>
						{ pluginTag ? __( 'Delete plugin' ) : __( 'Delete site' ) }
					</Button>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
