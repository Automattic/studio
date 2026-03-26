import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, moreVertical, keyboardReturn, reset } from '@wordpress/icons';
import React, { forwardRef, useRef, useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import { TELEX_HOSTNAME, TELEX_UTM_PARAMS } from 'src/constants';
import useAiIcon from 'src/hooks/use-ai-icon';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { addUrlParams } from 'src/lib/url-utils';

interface AIInputProps {
	disabled: boolean;
	input: string;
	setInput: ( input: string ) => void;
	handleSend: () => void;
	handleKeyDown: ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => void;
	clearConversation: () => void;
	isAssistantThinking: boolean;
}

const MAX_ROWS = 10;

// Sparkles icon used in Assistant tab (24px to match Icon component size)
const SparklesIcon = () => (
	<svg
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		style={ { display: 'inline-block' } }
	>
		<g transform="translate(5, 5)" clipPath="url(#clip0_2870_30744)">
			<path
				d="M13.7035 6.58213L10.8309 5.59124C9.69491 5.20089 8.79911 4.30509 8.40876 3.16908L7.41787 0.296515C7.28275 -0.0988382 6.71725 -0.0988382 6.58213 0.296515L5.59124 3.16908C5.20089 4.30509 4.30509 5.20089 3.16908 5.59124L0.296515 6.58213C-0.0988382 6.71725 -0.0988382 7.28275 0.296515 7.41787L3.16908 8.40876C4.30509 8.79911 5.20089 9.69491 5.59124 10.8309L6.58213 13.7035C6.71725 14.0988 7.28275 14.0988 7.41787 13.7035L8.40876 10.8309C8.79911 9.69491 9.69491 8.79911 10.8309 8.40876L13.7035 7.41787C14.0988 7.28275 14.0988 6.71725 13.7035 6.58213ZM10.3505 7.21269L8.91421 7.70813C8.3437 7.90331 7.8983 8.35371 7.70313 8.91921L7.20768 10.3555C7.13762 10.5557 6.85737 10.5557 6.79231 10.3555L6.29687 8.91921C6.1017 8.3487 5.6513 7.90331 5.08579 7.70813L3.64951 7.21269C3.44933 7.14263 3.44933 6.86238 3.64951 6.79232L5.08579 6.29687C5.6563 6.1017 6.1017 5.6513 6.29687 5.08579L6.79231 3.64951C6.86238 3.44933 7.14263 3.44933 7.20768 3.64951L7.70313 5.08579C7.8983 5.6563 8.3487 6.1017 8.91421 6.29687L10.3505 6.79232C10.5507 6.86238 10.5507 7.14263 10.3505 7.21269Z"
				fill="currentColor"
			/>
		</g>
		<defs>
			<clipPath id="clip0_2870_30744">
				<rect width="14" height="14" fill="white" />
			</clipPath>
		</defs>
	</svg>
);

const UnforwardedAIInput = (
	{
		disabled,
		input,
		setInput,
		handleSend,
		handleKeyDown,
		clearConversation,
		isAssistantThinking,
	}: AIInputProps,
	inputRef: React.RefObject< HTMLTextAreaElement > | React.RefCallback< HTMLTextAreaElement > | null
) => {
	const [ isTyping, setIsTyping ] = useState( false );
	const [ thinkingDuration, setThinkingDuration ] = useState<
		'short' | 'medium' | 'long' | 'veryLong'
	>( 'short' );
	const typingTimeout = useRef< NodeJS.Timeout >();
	const thinkingTimeout = useRef< NodeJS.Timeout[] >( [] );

	const { RiveComponent } = useAiIcon( {
		inactive: disabled,
		thinking: isAssistantThinking,
		typing: isTyping,
	} );

	useEffect( () => {
		if ( ! disabled && inputRef && 'current' in inputRef && inputRef.current ) {
			inputRef.current?.focus();
		}
	}, [ disabled, inputRef ] );

	useEffect(
		() => () => {
			if ( typingTimeout.current ) {
				clearTimeout( typingTimeout.current );
			}
		},
		[]
	);

	const handleInput = ( e: React.ChangeEvent< HTMLTextAreaElement > ) => {
		setInput( e.target.value );

		if ( inputRef && 'current' in inputRef && inputRef.current ) {
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
			if ( isAssistantThinking ) {
				return;
			}
			if ( input.trim() !== '' ) {
				handleSend();
				if ( inputRef && 'current' in inputRef && inputRef.current ) {
					// Reset the input height to default when the user sends the message
					inputRef.current.style.height = 'auto';
				}
			}
		} else if ( e.key === 'Enter' && e.shiftKey ) {
			// Allow Shift + Enter to create a new line
			return;
		} else {
			setIsTyping( true );
			handleKeyDown( e );
		}
	};

	const handleKeyUpWrapper = () => {
		if ( typingTimeout.current ) {
			clearTimeout( typingTimeout.current );
		}

		typingTimeout.current = setTimeout( () => {
			setIsTyping( false );
		}, 400 );
	};

	useEffect( () => {
		function clearThinkingTimeouts() {
			thinkingTimeout.current.forEach( clearTimeout );
			thinkingTimeout.current = [];
		}
		if ( isAssistantThinking ) {
			thinkingTimeout.current.push(
				setTimeout( () => {
					setThinkingDuration( 'medium' );
				}, 3000 )
			);

			thinkingTimeout.current.push(
				setTimeout( () => {
					setThinkingDuration( 'long' );
				}, 6000 )
			);

			thinkingTimeout.current.push(
				setTimeout( () => {
					setThinkingDuration( 'veryLong' );
				}, 10000 )
			);
		} else {
			clearThinkingTimeouts();
			setThinkingDuration( 'short' );
		}

		return () => {
			clearThinkingTimeouts();
		};
	}, [ isAssistantThinking ] );

	const getPlaceholderText = () => {
		if ( isAssistantThinking ) {
			switch ( thinkingDuration ) {
				case 'veryLong':
					return __( 'Stick with me…' );
				case 'long':
					return __( 'This is taking a little longer than I thought…' );
				case 'medium':
					return __( 'Still working on it…' );
				default:
					return __( 'Thinking about that…' );
			}
		}
		return __( 'What would you like to learn?' );
	};

	const handleClearConversation = async () => {
		if ( localStorage.getItem( 'dontShowClearMessagesWarning' ) === 'true' ) {
			clearConversation();
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

			clearConversation();
		}
	};

	return (
		<div
			className={ cx(
				`flex items-end w-full border rounded-sm bg-frame ${
					disabled ? 'border-frame-border' : 'border-frame-border focus-within:border-frame-theme'
				}`
			) }
		>
			<div className={ cx( 'flex items-center h-12', disabled && 'opacity-20 grayscale' ) }>
				<RiveComponent aria-hidden="true" style={ { width: 48, height: 48 } } />
			</div>
			<textarea
				ref={ inputRef }
				disabled={ disabled }
				placeholder={ getPlaceholderText() }
				className={ cx(
					`w-full px-1 py-3.5 rounded-sm border-none bg-transparent resize-none focus:outline-none assistant-textarea ${
						disabled ? 'cursor-not-allowed opacity-30' : ''
					}`
				) }
				value={ input }
				onChange={ handleInput }
				onKeyDown={ handleKeyDownWrapper }
				onKeyUp={ handleKeyUpWrapper }
				rows={ 1 }
				data-testid="ai-input-textarea"
			/>
			{ input.trim() !== '' && (
				<div className="flex items-center h-12">
					<Icon icon={ keyboardReturn } size={ 13 } fill="#cccccc" />
				</div>
			) }
			<DropdownMenu
				icon={ moreVertical }
				label={ __( 'Assistant Menu' ) }
				className="p-1 flex items-center h-12"
			>
				{ ( { onClose }: { onClose: () => void } ) => (
					<>
						<MenuGroup>
							<MenuItem
								data-testid="telex-link-button"
								onClick={ () => {
									const telexUrl = addUrlParams( `https://${ TELEX_HOSTNAME }/`, TELEX_UTM_PARAMS );
									getIpcApi().openURL( telexUrl );
									onClose();
								} }
								className="flex flex-row"
							>
								<SparklesIcon />
								<span className="ltr:pl-2 rtl:pl-2">{ __( 'Build with Telex' ) }</span>
								<ArrowIcon />
							</MenuItem>
							<MenuItem
								isDestructive
								data-testid="clear-conversation-button"
								onClick={ () => {
									void handleClearConversation();
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

export const AIInput = forwardRef( UnforwardedAIInput );
