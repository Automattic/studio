import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { getSnapshotHostname } from '@/data/snapshot-url';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { usePublishPreview } from './use-publish-preview';
import type { RefObject } from 'react';

export function PreviewOverwriteConfirmation( {
	preview,
	inline,
	returnFocus,
}: {
	preview: ReturnType< typeof usePublishPreview >;
	inline: boolean;
	returnFocus: RefObject< HTMLButtonElement | null >;
} ) {
	const { overwrite, cancelOverwrite, confirmOverwrite, canUpdate, pending } = preview;
	if ( ! overwrite ) return null;
	const title = overwrite.unknown
		? __( 'Replace preview contents?' )
		: __( 'Replace preview changes?' );
	const description = sprintf(
		overwrite.unknown
			? __(
					'Changes on %s could not be checked. Updating will replace its files and database with your local copy.'
			  )
			: __( 'Changes on %s will be replaced with your local files and database.' ),
		getSnapshotHostname( overwrite.snapshot )
	);
	const actions = (
		<>
			<Button variant="outline" onClick={ cancelOverwrite }>
				{ __( 'Cancel' ) }
			</Button>
			<Button
				variant="accent"
				disabled={ ! canUpdate }
				loading={ pending }
				onClick={ () => void confirmOverwrite() }
			>
				{ __( 'Replace preview' ) }
			</Button>
		</>
	);
	if ( inline ) {
		return (
			<>
				<div className={ styles.previewOverwriteCopy }>
					<Popover.Title>{ title }</Popover.Title>
					<Popover.Description>{ description }</Popover.Description>
				</div>
				<div className={ clsx( styles.shareFooter, styles.footerActions ) }>{ actions }</div>
			</>
		);
	}
	return (
		<AlertDialog open onOpenChange={ ( next ) => ! next && cancelOverwrite() }>
			<DialogContent layout="confirmation" finalFocus={ returnFocus }>
				<DialogHeader>
					<DialogTitle>{ title }</DialogTitle>
					<DialogDescription>{ description }</DialogDescription>
				</DialogHeader>
				<DialogFooter>{ actions }</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
