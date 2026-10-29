import { __ } from '@wordpress/i18n';
import { useRef, useState } from 'react';
import { useRenameSnapshot } from '@/data/queries/use-snapshots';
import { getSnapshotHostname } from '@/data/snapshot-url';
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from '@/lib/ui';
import styles from './style.module.css';
import type { Snapshot } from '@/data/core';

export function RenamePreviewDialog( {
	snapshot,
	onClose,
}: {
	snapshot: Snapshot;
	onClose: () => void;
} ) {
	const rename = useRenameSnapshot();
	const inputRef = useRef< HTMLInputElement >( null );
	const [ name, setName ] = useState( snapshot.name ?? '' );
	return (
		<Dialog open onOpenChange={ ( next ) => ! next && ! rename.isPending && onClose() }>
			<DialogContent
				layout="compact"
				initialFocus={ inputRef }
				finalFocus={ false }
				closeButtonDisabled={ rename.isPending }
			>
				<form
					className={ styles.renameForm }
					onSubmit={ ( event ) => {
						event.preventDefault();
						if ( ! name.trim() || rename.isPending ) return;
						if ( name.trim() === snapshot.name ) {
							onClose();
							return;
						}
						rename.mutate(
							{ hostname: getSnapshotHostname( snapshot ), name: name.trim() },
							{ onSuccess: onClose }
						);
					} }
				>
					<DialogHeader>
						<DialogTitle>{ __( 'Rename preview' ) }</DialogTitle>
						<DialogDescription>
							{ __( 'Choose a name that’s easy to find later.' ) }
						</DialogDescription>
					</DialogHeader>
					<Input
						ref={ inputRef }
						aria-label={ __( 'Preview name' ) }
						value={ name }
						disabled={ rename.isPending }
						onChange={ ( event ) => setName( event.target.value ) }
						onFocus={ ( event ) => event.target.select() }
						autoFocus
					/>
					{ rename.error ? (
						<p className={ styles.error } role="alert">
							{ rename.error.message }
						</p>
					) : null }
					<DialogFooter>
						<DialogClose render={ <Button variant="outline" /> } disabled={ rename.isPending }>
							{ __( 'Cancel' ) }
						</DialogClose>
						<Button type="submit" loading={ rename.isPending } disabled={ ! name.trim() }>
							{ __( 'Save' ) }
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
