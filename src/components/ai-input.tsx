import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, moreVertical, keyboardReturn, reset } from '@wordpress/icons';
import React, { useRef, useEffect } from 'react';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { AssistantIcon } from './icons/assistant';

interface AIInputProps {
	disabled: boolean;
	input: string;
	setInput: ( input: string ) => void;
	handleSend: () => void;
	handleKeyDown: ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => void;
	clearInput: () => void;
	isAssistantThinking: boolean;
}

const MAX_ROWS = 10;

export const AIInput = ( {
	disabled,
	input,
	setInput,
	handleSend,
	handleKeyDown,
	clearInput,
	isAssistantThinking,
}: AIInputProps ) => {
	const inputRef = useRef< HTMLTextAreaElement >( null );

	useEffect( () => {
		if ( ! disabled && inputRef.current ) {
			inputRef.current.focus();
		}
	}, [ disabled ] );

	const handleInput = ( e: React.ChangeEvent< HTMLTextAreaElement > ) => {
		setInput( e.target.value );

		if ( inputRef.current ) {
			// Reset the height of the textarea to auto to recalculate the height
			inputRef.current.style.height = 'auto';

			// Calculate the maximum height based on the maximum number of rows
			const lineHeight = parseInt( window.getComputedStyle( inputRef.current ).lineHeight, 10 );
			const maxHeight = MAX_ROWS * lineHeight;

			// Set the height of the textarea to the minimum of its scrollHeight and the maximum height
			inputRef.current.style.height = `${ Math.min( inputRef.current.scrollHeight, maxHeight ) }px`;

			// If the scrollHeight exceeds the maximum height, enable vertical scrolling
			// Otherwise, hide the scrollbar
			inputRef.current.style.overflowY =
				inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';

			// Scroll to the bottom if the content exceeds the maximum height
			inputRef.current.scrollTop = inputRef.current.scrollHeight;
		}
	};

	const handleKeyDownWrapper = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			if ( input.trim() !== '' ) {
				handleSend();
				if ( inputRef.current ) {
					// Reset the input height to default when the user sends the message
					inputRef.current.style.height = 'auto';
				}
			}
		} else if ( e.key === 'Enter' && e.shiftKey ) {
			// Allow Shift + Enter to create a new line
			return;
		} else {
			handleKeyDown( e );
		}
	};

	const getPlaceholderText = () => {
		return isAssistantThinking ? __( 'Generating...' ) : __( 'What would you like to learn?' );
	};

	const handleClearConversation = async () => {
		if ( localStorage.getItem( 'dontShowClearMessagesWarning' ) === 'true' ) {
			clearInput();
			return;
		}

		const CLEAR_CONVERSATION_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
			message: __( 'Are you sure you want to clear the conversation?' ),
			checkboxLabel: __( "Don't show this warning again" ),
			buttons: [ __( 'OK' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === CLEAR_CONVERSATION_BUTTON_INDEX ) {
			if ( checkboxChecked ) {
				localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
			}

			clearInput();
		}
	};

	return (
		<div
			className={ cx(
				`flex w-full border rounded-sm bg-white/[0.9] ${
					disabled ? 'border-a8c-gray-5' : 'border-gray-300 focus-within:border-a8c-blueberry'
				}`
			) }
		>
			<div className={ `flex items-end p-3 ltr:pr-2 rtl:pl-2` }>
				<AssistantIcon
					size={ 28 }
					aria-hidden="true"
					className={ disabled ? 'fill-a8c-gray-30 opacity-30' : 'fill-a8c-blueberry' }
				/>
			</div>
			<textarea
				ref={ inputRef }
				disabled={ disabled }
				placeholder={ getPlaceholderText() }
				className={ cx(
					`w-full mt-1 px-2 py-3 rounded-sm border-none bg-transparent resize-none focus:outline-none assistant-textarea ${
						disabled ? 'cursor-not-allowed opacity-30' : ''
					}`
				) }
				value={ input }
				onChange={ handleInput }
				onKeyDown={ handleKeyDownWrapper }
				rows={ 1 }
				data-testid="ai-input-textarea"
			/>
			{ input.trim() !== '' && (
				<div className="flex items-end py-4 mb-1">
					<Icon icon={ keyboardReturn } size={ 13 } fill="#cccccc" />
				</div>
			) }
			<DropdownMenu icon={ moreVertical } label={ __( 'Assistant Menu' ) } className="p-2">
				{ ( { onClose }: { onClose: () => void } ) => (
					<>
						<MenuGroup>
							<MenuItem
								isDestructive
								data-testid="clear-conversation-button"
								onClick={ () => {
									handleClearConversation();
									onClose();
								} }
							>
								<Icon className="text-red-600" icon={ reset } />
								<span className="ltr:pl-2 rtl:pl-2">{ __( 'Clear conversation' ) }</span>
							</MenuItem>
						</MenuGroup>
					</>
				) }
			</DropdownMenu>
		</div>
	);
};
