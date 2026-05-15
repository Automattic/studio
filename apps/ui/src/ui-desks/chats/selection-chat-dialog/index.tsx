import { __ } from '@wordpress/i18n';
import { arrowUp } from '@wordpress/icons';
import { useEffect, useRef, useState } from 'react';
import { useChats } from '@/ui-desks/chats/context';
import {
	buildWidgetContextDisplayMessage,
	buildWidgetContextPrompt,
	WidgetContextThumbnailList,
} from '@/ui-desks/chats/widget-context';
import {
	Button,
	Dialog,
	DialogError,
	DialogRow,
	dialogInputClassName,
} from '@/ui-desks/components';
import type { DeskWidget } from '@/ui-desks/widgets/types';

interface SelectionChatDialogProps {
	widgets: DeskWidget[];
	onClose: () => void;
}

export function SelectionChatDialog( { widgets, onClose }: SelectionChatDialogProps ) {
	const { startChatWithPrompt, isCreatingChat } = useChats();
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const [ prompt, setPrompt ] = useState( '' );
	const [ error, setError ] = useState< string | null >( null );
	const canSubmit = prompt.trim().length > 0 && ! isCreatingChat;

	useEffect( () => {
		textareaRef.current?.focus();
	}, [] );

	const submitPrompt = async () => {
		const userPrompt = prompt.trim();
		if ( ! userPrompt || isCreatingChat ) {
			return;
		}

		setError( null );
		try {
			await startChatWithPrompt( {
				prompt: buildWidgetContextPrompt( userPrompt, widgets ),
				displayMessage: buildWidgetContextDisplayMessage( userPrompt, widgets ),
			} );
			onClose();
		} catch ( submitError ) {
			setError(
				submitError instanceof Error ? submitError.message : __( 'Unable to start chat.' )
			);
		}
	};

	return (
		<Dialog
			ariaLabel={ __( 'Chat about selection' ) }
			as="form"
			onClose={ onClose }
			onSubmit={ ( event ) => {
				event.preventDefault();
				void submitPrompt();
			} }
		>
			<DialogRow>
				<textarea
					ref={ textareaRef }
					className={ dialogInputClassName }
					value={ prompt }
					rows={ 1 }
					placeholder={ __( 'Ask about this selection...' ) }
					onChange={ ( event ) => setPrompt( event.target.value ) }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
							event.preventDefault();
							void submitPrompt();
						}
					} }
				/>
				<Button
					icon={ arrowUp }
					label={ isCreatingChat ? __( 'Creating chat' ) : __( 'Send' ) }
					disabled={ ! canSubmit }
					aria-busy={ isCreatingChat }
					onClick={ () => void submitPrompt() }
					tooltipSide="left"
					variant="filled"
					tone="primary"
					size="large"
				/>
			</DialogRow>
			<WidgetContextThumbnailList widgets={ widgets } />
			{ error && <DialogError>{ error }</DialogError> }
		</Dialog>
	);
}
