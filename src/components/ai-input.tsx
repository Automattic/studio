import { __ } from '@wordpress/i18n';
import { Icon, moreVertical, keyboardReturn } from '@wordpress/icons';
import React, { useRef, useEffect } from 'react';
import Button from './button';
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

	return (
		<div className="px-8 py-5 bg-white flex items-center border border-gray-200">
			<div className="flex w-full border border-gray-300 rounded-sm focus-within:border-a8c-blueberry">
				<div className="flex items-end p-3 ltr:pr-2 rtl:pl-2">
					<AssistantIcon size={ 28 } aria-hidden="true" />
				</div>
				<textarea
					ref={ inputRef }
					disabled={ disabled }
					placeholder={ getPlaceholderText() }
					className="w-full mt-1 px-2 py-3 rounded-sm border-none resize-none focus:outline-none"
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
				<div className="flex items-end py-2 ltr:mr-2 rtl:ml-1">
					<Button
						disabled={ disabled }
						aria-label="menu"
						className="py-2 px-1 cursor-pointer"
						onClick={ clearInput }
					>
						<Icon icon={ moreVertical } size={ 22 } />
					</Button>
				</div>
			</div>
		</div>
	);
};
