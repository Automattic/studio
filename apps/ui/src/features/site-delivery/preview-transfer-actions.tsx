import { Button } from '@studio/ds';
import { __ } from '@wordpress/i18n';
import type { Ref } from 'react';

export function PreviewTransferActions( {
	previewMayHaveChanges,
	disabled,
	updating,
	pullButton,
	updateButton,
	onPull,
	onUpdate,
}: {
	previewMayHaveChanges: boolean;
	disabled: boolean;
	updating: boolean;
	pullButton: Ref< HTMLButtonElement >;
	updateButton: Ref< HTMLButtonElement >;
	onPull?: () => void;
	onUpdate: () => void;
} ) {
	return (
		<>
			{ onPull && ! updating && (
				<Button ref={ pullButton } variant="outline" disabled={ disabled } onClick={ onPull }>
					{ __( 'Pull from preview…' ) }
				</Button>
			) }
			<Button
				ref={ updateButton }
				variant="accent"
				disabled={ disabled || updating }
				loading={ updating }
				onClick={ onUpdate }
			>
				{ updating ? __( 'Updating…' ) : previewMayHaveChanges ? __( 'Update…' ) : __( 'Update' ) }
			</Button>
		</>
	);
}
