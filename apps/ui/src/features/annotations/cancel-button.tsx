import { __ } from '@wordpress/i18n';
import { Trash2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import {
	AlertDialog,
	Button,
	IconButton,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	type ButtonSize,
} from '@/lib/ui';
import {
	clearAnnotations,
	hasAnnotationContent,
	isAnnotationsBusy,
	useSiteAnnotations,
} from './store';

export function AnnotationCancelButton( {
	siteId,
	size,
	iconOnly = false,
	className,
}: {
	siteId: string;
	size?: ButtonSize;
	iconOnly?: boolean;
	className?: string;
} ) {
	const annotations = useSiteAnnotations( siteId );
	const [ confirming, setConfirming ] = useState( false );
	const cancelRef = useRef< HTMLButtonElement >( null );
	const disabled = isAnnotationsBusy( annotations );
	const cancel = () => {
		if ( annotations.notes.some( hasAnnotationContent ) ) {
			setConfirming( true );
		} else {
			clearAnnotations( siteId );
		}
	};
	return (
		<>
			{ iconOnly ? (
				<IconButton
					variant="ghost"
					size={ size }
					className={ className }
					label={ __( 'Discard annotations' ) }
					icon={ <Trash2Icon /> }
					tooltipSide="bottom"
					disabled={ disabled }
					onClick={ cancel }
				/>
			) : (
				<Button
					variant="ghost"
					size={ size }
					className={ className }
					disabled={ disabled }
					onClick={ cancel }
				>
					{ __( 'Cancel' ) }
				</Button>
			) }
			<AlertDialog open={ confirming } onOpenChange={ setConfirming }>
				<DialogContent layout="confirmation" initialFocus={ cancelRef }>
					<DialogHeader>
						<DialogTitle>{ __( 'Discard all pending annotations?' ) }</DialogTitle>
						<DialogDescription tone="default">
							{ __( 'All edits will be removed from this page.' ) }
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button ref={ cancelRef } variant="outline" onClick={ () => setConfirming( false ) }>
							{ __( 'Cancel' ) }
						</Button>
						<Button
							variant="destructive"
							onClick={ () => {
								setConfirming( false );
								clearAnnotations( siteId );
							} }
						>
							{ __( 'Discard' ) }
						</Button>
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
		</>
	);
}
