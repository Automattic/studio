import { getSnapshotExpiry } from '@studio/common/lib/snapshots';
import { Button, Field, FieldLabel, Input } from '@studio/ds';
import { __, sprintf } from '@wordpress/i18n';
import { useId, useState } from 'react';
import { useRenameSnapshot } from '@/data/queries/use-snapshots';
import { getSnapshotHostname } from '@/data/snapshot-url';
import styles from './style.module.css';
import type { Snapshot } from '@/data/core';

export function previewExpiry(
	snapshot: Snapshot,
	locale?: string,
	format: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
) {
	return sprintf(
		/* translators: %s: the date a preview site expires */
		__( 'Expires %s' ),
		new Date( getSnapshotExpiry( snapshot ) ).toLocaleDateString( locale, format )
	);
}

export function RenamePreview( { snapshot, onDone }: { snapshot: Snapshot; onDone: () => void } ) {
	const id = useId();
	const rename = useRenameSnapshot();
	const [ name, setName ] = useState( snapshot.name ?? '' );
	const save = () => {
		if ( ! name.trim() || name.trim() === snapshot.name ) {
			onDone();
			return;
		}
		rename.mutate(
			{ hostname: getSnapshotHostname( snapshot ), name: name.trim() },
			{ onSuccess: onDone }
		);
	};
	return (
		<form
			className={ styles.inlineForm }
			onSubmit={ ( event ) => {
				event.preventDefault();
				save();
			} }
		>
			<Field>
				<FieldLabel htmlFor={ id }>{ __( 'Preview name' ) }</FieldLabel>
				<Input
					id={ id }
					value={ name }
					autoFocus
					disabled={ rename.isPending }
					onChange={ ( event ) => setName( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Escape' ) {
							event.stopPropagation();
							onDone();
						}
					} }
				/>
			</Field>
			{ rename.error ? (
				<p className={ styles.error } role="alert">
					{ rename.error.message }
				</p>
			) : null }
			<div className={ styles.confirmActions }>
				<Button variant="ghost" onClick={ onDone }>
					{ __( 'Cancel' ) }
				</Button>
				<Button variant="accent" type="submit" loading={ rename.isPending }>
					{ __( 'Save' ) }
				</Button>
			</div>
		</form>
	);
}
