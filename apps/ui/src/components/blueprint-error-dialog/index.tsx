import { __ } from '@wordpress/i18n';
import { Dialog } from '@wordpress/ui';
import styles from './style.module.css';

interface BlueprintErrorDialogProps {
	error: string;
	onDismiss: () => void;
}

export function BlueprintErrorDialog( { error, onDismiss }: BlueprintErrorDialogProps ) {
	return (
		<Dialog.Root
			open={ Boolean( error ) }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onDismiss();
				}
			} }
		>
			<Dialog.Popup size="small">
				<Dialog.Header>
					<Dialog.Title>{ __( 'Blueprint error' ) }</Dialog.Title>
				</Dialog.Header>
				<Dialog.Content>
					<Dialog.Description className={ styles.message }>{ error }</Dialog.Description>
				</Dialog.Content>
				<Dialog.Footer>
					<Dialog.Action variant="minimal" tone="neutral">
						{ __( 'Close' ) }
					</Dialog.Action>
				</Dialog.Footer>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
