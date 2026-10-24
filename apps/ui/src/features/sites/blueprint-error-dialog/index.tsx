import { __ } from '@wordpress/i18n';
import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/lib/ui';
import styles from './style.module.css';

interface BlueprintErrorDialogProps {
	error: string;
	onDismiss: () => void;
}

export function BlueprintErrorDialog( { error, onDismiss }: BlueprintErrorDialogProps ) {
	return (
		<Dialog
			open={ Boolean( error ) }
			onOpenChange={ ( next ) => {
				if ( ! next ) {
					onDismiss();
				}
			} }
		>
			<DialogContent showCloseButton={ false }>
				<DialogHeader>
					<DialogTitle>{ __( 'Blueprint error' ) }</DialogTitle>
					<DialogDescription tone="default" className={ styles.message }>
						{ error }
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={ <Button variant="outline" /> }>{ __( 'Close' ) }</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
