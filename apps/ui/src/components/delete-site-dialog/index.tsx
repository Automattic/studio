import { __, _n, sprintf } from '@wordpress/i18n';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	AlertDialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
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
	const [ pending, setPending ] = useState( false );
	const [ error, setError ] = useState< string >();
	const cancelRef = useRef< HTMLButtonElement >( null );
	const deleteFilesId = useId();
	const count = sites.length;
	const confirmLabel = _n( 'Delete site', 'Delete sites', count );
	const handleKeyDown = useConfirmOnEnter( confirmLabel );

	// One at a time, so a failure leaves the rest deleted and is reported.
	const handleConfirm = async () => {
		setPending( true );
		setError( undefined );
		const errors: string[] = [];
		for ( const site of sites ) {
			try {
				await deleteSite.mutateAsync( { id: site.id, deleteFiles } );
			} catch ( err ) {
				errors.push( ( err as Error )?.message );
			}
		}
		setPending( false );
		if ( errors.length < count ) {
			onDeleted?.();
		}
		if ( ! errors.length ) {
			onOpenChange( false );
			return;
		}
		const reason = errors.find( Boolean ) ?? __( 'Unable to delete the site. Please try again.' );
		setError(
			count === 1
				? reason
				: sprintf(
						/* translators: 1: sites deleted, 2: sites selected, 3: sites that failed, 4: the first error. */
						__( '%1$d of %2$d sites deleted. %3$d failed: %4$s' ),
						count - errors.length,
						count,
						errors.length,
						reason
				  )
		);
	};

	return (
		<AlertDialog
			open={ open }
			onOpenChange={ ( next ) => ! pending && onOpenChange( next ) }
			onOpenChangeComplete={ ( next ) => ! next && setError( undefined ) }
		>
			<DialogContent
				layout="confirmation"
				showCloseButton={ ! pending }
				initialFocus={ cancelRef }
				onKeyDown={ handleKeyDown }
			>
				<DialogHeader>
					<DialogTitle>
						{ count === 1
							? sprintf( __( 'Delete %s' ), sites[ 0 ].name )
							: sprintf(
									/* translators: %d: number of sites. */
									_n( 'Delete %d site', 'Delete %d sites', count ),
									count
							  ) }
					</DialogTitle>
					<DialogDescription tone="default">
						{ count === 1
							? __(
									"The site's database will be lost, including all posts, pages, comments, and media."
							  )
							: __(
									"These sites' databases will be lost, including all their posts, pages, comments, and media."
							  ) }
					</DialogDescription>
				</DialogHeader>
				<Field orientation="horizontal">
					<Checkbox
						id={ deleteFilesId }
						checked={ deleteFiles }
						onCheckedChange={ setDeleteFiles }
						disabled={ pending }
					/>
					<FieldLabel htmlFor={ deleteFilesId } tone="muted">
						{ __( 'Delete site files from my computer' ) }
					</FieldLabel>
				</Field>
				{ error ? (
					<p role="alert" className={ styles.error }>
						{ error }
					</p>
				) : null }
				<DialogFooter>
					<Button
						ref={ cancelRef }
						variant="outline"
						disabled={ pending }
						onClick={ () => onOpenChange( false ) }
					>
						{ __( 'Cancel' ) }
					</Button>
					<Button variant="destructive" loading={ pending } onClick={ () => void handleConfirm() }>
						{ confirmLabel }
					</Button>
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
