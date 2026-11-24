import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@studio/ds';
import { __, sprintf } from '@wordpress/i18n';
import { useRef } from 'react';
import { getSnapshotHostname } from '@/data/snapshot-url';
import type { usePublishPreview } from './use-publish-preview';

export function PreviewOverwriteConfirmation( {
	preview,
	onCancel,
	returnFocus,
}: {
	preview: ReturnType< typeof usePublishPreview >;
	onCancel: () => void;
	returnFocus: () => HTMLButtonElement | null;
} ) {
	const cancel = useRef< HTMLButtonElement >( null );
	const { overwrite, confirmOverwrite, canUpdate, pending } = preview;
	if ( ! overwrite ) return null;
	return (
		<AlertDialog open onOpenChange={ ( next ) => ! next && ! pending && onCancel() }>
			<DialogContent
				layout="confirmation"
				initialFocus={ cancel }
				finalFocus={ returnFocus }
				closeButtonDisabled={ pending }
			>
				<DialogHeader>
					<DialogTitle>
						{ overwrite.unknown
							? __( 'Replace preview contents?' )
							: __( 'Replace preview changes?' ) }
					</DialogTitle>
					<DialogDescription>
						{ sprintf(
							overwrite.unknown
								? __(
										'Studio can’t tell whether anyone edited %s. Updating the preview will replace it with your local site.'
								  )
								: __( 'Changes on %s will be replaced with your local files and database.' ),
							getSnapshotHostname( overwrite.snapshot )
						) }
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button ref={ cancel } variant="outline" disabled={ pending } onClick={ onCancel }>
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
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
