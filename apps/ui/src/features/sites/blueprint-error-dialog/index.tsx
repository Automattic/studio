import { __ } from '@wordpress/i18n';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
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
