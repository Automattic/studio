import { __ } from '@wordpress/i18n';
import { useLayoutEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogRow, dialogInputClassName } from '@/ui-desks/components';
import styles from './style.module.css';
import type { AnnotationPayload } from '../inspector';
import type { FormEvent, KeyboardEvent } from 'react';

interface AnnotationCommentDialogProps {
	payload: AnnotationPayload;
	onAdd: ( comment: string ) => void;
	onCancel: () => void;
}

export function AnnotationCommentDialog( {
	payload,
	onAdd,
	onCancel,
}: AnnotationCommentDialogProps ) {
	const [ text, setText ] = useState( '' );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const canSubmit = text.trim().length > 0;

	useLayoutEffect( () => {
		const textarea = textareaRef.current;
		if ( ! textarea ) {
			return;
		}
		textarea.style.height = 'auto';
		textarea.style.height = `${ textarea.scrollHeight }px`;
	}, [ text ] );

	const submit = ( event?: FormEvent ) => {
		event?.preventDefault();
		const trimmed = text.trim();
		if ( ! trimmed ) {
			return;
		}
		onAdd( trimmed );
	};

	const handleKeyDown = ( event: KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( event.key === 'Enter' && ! event.shiftKey ) {
			event.preventDefault();
			submit();
		}
	};

	return (
		<Dialog
			ariaLabel={ __( 'Add annotation' ) }
			as="form"
			gap="compact"
			onClose={ onCancel }
			onSubmit={ submit }
		>
			<div className={ styles.header } title={ payload.selector }>
				{ __( 'On' ) }
				<code>{ payload.displayName }</code>
			</div>
			<DialogRow>
				<textarea
					ref={ textareaRef }
					className={ dialogInputClassName }
					placeholder={ __( 'What should change about this element?' ) }
					autoFocus
					rows={ 1 }
					value={ text }
					onChange={ ( event ) => setText( event.target.value ) }
					onKeyDown={ handleKeyDown }
				/>
				<Button
					type="submit"
					intent="chat"
					label={ __( 'Add annotation' ) }
					variant="filled"
					tone="primary"
					size="large"
					disabled={ ! canSubmit }
					tooltipLabel={ false }
				>
					{ __( 'Add' ) }
				</Button>
			</DialogRow>
		</Dialog>
	);
}
