import React, { useRef, useEffect, useState } from 'react';
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
	const [ height, setHeight ] = useState( 'auto' );

	useEffect( () => {
		if ( ! disabled && inputRef.current ) {
			inputRef.current.focus();
		}
	}, [ disabled ] );

	useEffect( () => {
		if ( inputRef.current ) {
			inputRef.current.style.height = 'auto';
			inputRef.current.style.height = `${ inputRef.current.scrollHeight }px`;
			setHeight( `${ inputRef.current.scrollHeight }px` );
		}
	}, [ input ] );

	const handleKeyDownWrapper = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			handleSend();
			if ( input.trim().split( '\n' ).length === 1 ) {
				setHeight( 'auto' );
			}
		} else {
			handleKeyDown( e );
		}
	};

	console.log( 'isAssistantThinking?', isAssistantThinking );

	return (
		<div
			data-testid="assistant-input"
			className="px-8 py-5 bg-white flex items-center border border-gray-200"
		>
			<div className="flex items-center w-full border border-gray-300 rounded-sm focus-within:border-blue-500">
				<div className="p-2">
					<AssistantIcon size={ 28 } />
				</div>
				<textarea
					ref={ inputRef }
					disabled={ disabled }
					placeholder="What would you like to learn?"
					className="w-full px-1 py-3 rounded-sm border-none resize-none focus:outline-none"
					value={ input }
					onChange={ ( e ) => setInput( e.target.value ) }
					onKeyDown={ handleKeyDownWrapper }
					style={ { height } }
					rows={ 1 }
				/>
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
	);
};
