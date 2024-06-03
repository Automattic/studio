import React, { useRef, useEffect } from 'react';
import { useAuth } from '../hooks/use-auth';
import { useOffline } from '../hooks/use-offline';
import { cx } from '../lib/cx';
import Button from './button';
import { AssistantIcon } from './icons/assistant';
import { MenuIcon } from './icons/menu';

interface AIInputProps {
	input: string;
	setInput: ( input: string ) => void;
	handleSend: () => void;
	handleKeyDown: ( e: React.KeyboardEvent< HTMLInputElement > ) => void;
	clearInput: () => void;
	isAssistantThinking: boolean;
}

export const AIInput: React.FC< AIInputProps > = ( {
	input,
	setInput,
	handleKeyDown,
	clearInput,
	isAssistantThinking,
} ) => {
	const inputRef = useRef< HTMLInputElement >( null );
	const { isAuthenticated } = useAuth();
	const isOffline = useOffline();

	useEffect( () => {
		if ( isAuthenticated && inputRef.current ) {
			inputRef.current.focus();
		}
	}, [ isAuthenticated ] );

	const disabled = isOffline || ! isAuthenticated;

	return (
		<div
			data-testid="assistant-input"
			className="px-8 py-6 bg-white flex items-center border-t border-gray-200 sticky bottom-0"
		>
			<div className="relative flex-1">
				<input
					ref={ inputRef }
					disabled={ disabled }
					type="text"
					placeholder="Ask Studio WordPress Assistant"
					className="w-full p-3 rounded-sm border-black border ltr:pl-8 rtl:pr-8 disabled:border-gray-300 disabled:cursor-not-allowed"
					value={ input }
					onChange={ ( e ) => setInput( e.target.value ) }
					onKeyDown={ handleKeyDown }
				/>
				<div className="absolute top-1/2 transform -translate-y-1/2 ltr:left-3 rtl:left-auto rtl:right-3 pointer-events-none">
					<AssistantIcon />
				</div>
			</div>
			<Button
				disabled={ disabled }
				aria-label="menu"
				className="p-2 ml-2 cursor-pointer"
				onClick={ clearInput }
			>
				<MenuIcon />
			</Button>
		</div>
	);
};
