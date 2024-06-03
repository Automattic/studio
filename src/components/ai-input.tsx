import React, { useRef, useEffect } from 'react';
import Button from './button';
import { AssistantIcon } from './icons/assistant';
import { MenuIcon } from './icons/menu';

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
const LINE_HEIGHT = 30;

export const AIInput: React.FC< AIInputProps > = ( {
	disabled,
	input,
	setInput,
	handleSend,
	handleKeyDown,
	clearInput,
	isAssistantThinking,
} ) => {
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

			// Calculate the maximum height based on the maximum number of rows and the line height
			const maxHeight = MAX_ROWS * LINE_HEIGHT;

			// Set the height of the textarea to the minimum of its scrollHeight and the maximum height
			inputRef.current.style.height = `${ Math.min( inputRef.current.scrollHeight, maxHeight ) }px`;

			// If the scrollHeight exceeds the maximum height, enable vertical scrolling
			// Otherwise, hide the scrollbar
			inputRef.current.style.overflowY =
				inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';

			// Scroll to the bottom if the content exceeds the maximum height
			if ( inputRef.current.scrollHeight > maxHeight ) {
				inputRef.current.scrollTop = inputRef.current.scrollHeight;
			}
		}
	};

	const handleKeyDownWrapper = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			handleSend();
			if ( inputRef.current ) {
				// Reset the input height to default when the user sends the message
				inputRef.current.style.height = 'auto';
			}
		} else {
			handleKeyDown( e );
		}
	};

	return (
		<div className="px-8 py-5 bg-white flex items-center border border-gray-200">
			<div className="flex w-full border border-gray-300 rounded-sm focus-within:border-blue-500">
				<div className="flex items-end p-3 ltr:pr-2 rtl:pl-2">
					<AssistantIcon size={ 28 } />
				</div>
				<textarea
					ref={ inputRef }
					disabled={ disabled }
					placeholder="What would you like to learn?"
					className="w-full px-2 py-3 rounded-sm border-none resize-none focus:outline-none"
					value={ input }
					onChange={ handleInput }
					onKeyDown={ handleKeyDownWrapper }
					rows={ 1 }
					style={ { lineHeight: `${ LINE_HEIGHT }px` } }
					data-testid="ai-input-textarea"
				/>
				<div className="flex items-end p-2">
					<Button
						disabled={ disabled }
						aria-label="menu"
						className="p-2 cursor-pointer"
						onClick={ clearInput }
					>
						<MenuIcon />
					</Button>
				</div>
			</div>
		</div>
	);
};
