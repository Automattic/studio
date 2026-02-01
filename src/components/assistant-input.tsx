import { DropdownMenu, MenuGroup, MenuItem, Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, arrowUp, plus, moreVertical } from '@wordpress/icons';
import React, { forwardRef, useRef, useEffect, useState } from 'react';
import { cx } from 'src/lib/cx';

interface AssistantInputProps {
	disabled: boolean;
	input: string;
	setInput: ( input: string ) => void;
	handleSend: () => void;
	handleKeyDown?: ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => void;
	isLoading?: boolean;
	placeholder?: string;
	onClearConversation?: () => void;
	/** Optional slot for agent selector (rendered next to extended thinking) */
	agentSelector?: React.ReactNode;
	/** Optional slot for model selector (rendered next to agent selector) */
	modelSelector?: React.ReactNode;
	/** Optional footer content (e.g., disclaimer) */
	footer?: React.ReactNode;
	/** Callback when agent settings is clicked */
	onOpenAgentSettings?: () => void;
	/** Callback when skill settings is clicked */
	onOpenSkillSettings?: () => void;
	/** Callback when instruction settings is clicked */
	onOpenInstructionSettings?: () => void;
}

const MAX_ROWS = 10;

// Clock/timer icon for thinking mode (kept for future use)
const _ThinkingIcon = () => (
	<svg
		width="14"
		height="14"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<circle cx="12" cy="12" r="10" />
		<polyline points="12 6 12 12 16 14" />
	</svg>
);

const UnforwardedAssistantInput = (
	{
		disabled,
		input,
		setInput,
		handleSend,
		handleKeyDown,
		isLoading,
		placeholder,
		onClearConversation,
		agentSelector,
		modelSelector,
		footer,
		onOpenAgentSettings,
		onOpenSkillSettings,
		onOpenInstructionSettings,
	}: AssistantInputProps,
	inputRef: React.RefObject< HTMLTextAreaElement > | React.RefCallback< HTMLTextAreaElement > | null
) => {
	const [ thinkingDuration, setThinkingDuration ] = useState<
		'short' | 'medium' | 'long' | 'veryLong'
	>( 'short' );
	const thinkingTimeout = useRef< NodeJS.Timeout[] >( [] );

	useEffect( () => {
		if ( ! disabled && inputRef && 'current' in inputRef && inputRef.current ) {
			inputRef.current?.focus();
		}
	}, [ disabled, inputRef ] );

	const handleInput = ( e: React.ChangeEvent< HTMLTextAreaElement > ) => {
		setInput( e.target.value );

		if ( inputRef && 'current' in inputRef && inputRef.current ) {
			inputRef.current.style.height = 'auto';
			const lineHeight = parseInt( window.getComputedStyle( inputRef.current ).lineHeight, 10 );
			const maxHeight = MAX_ROWS * lineHeight;
			inputRef.current.style.height = `${ Math.min( inputRef.current.scrollHeight, maxHeight ) }px`;
			inputRef.current.style.overflowY =
				inputRef.current.scrollHeight > maxHeight ? 'auto' : 'hidden';
			inputRef.current.scrollTop = inputRef.current.scrollHeight;
		}
	};

	const handleKeyDownWrapper = ( e: React.KeyboardEvent< HTMLTextAreaElement > ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			if ( isLoading ) {
				return;
			}
			if ( input.trim() !== '' ) {
				handleSend();
				if ( inputRef && 'current' in inputRef && inputRef.current ) {
					inputRef.current.style.height = 'auto';
				}
			}
		} else if ( e.key === 'Enter' && e.shiftKey ) {
			return;
		} else if ( handleKeyDown ) {
			handleKeyDown( e );
		}
	};

	useEffect( () => {
		function clearThinkingTimeouts() {
			thinkingTimeout.current.forEach( clearTimeout );
			thinkingTimeout.current = [];
		}
		if ( isLoading ) {
			thinkingTimeout.current.push(
				setTimeout( () => setThinkingDuration( 'medium' ), 3000 ),
				setTimeout( () => setThinkingDuration( 'long' ), 6000 ),
				setTimeout( () => setThinkingDuration( 'veryLong' ), 10000 )
			);
		} else {
			clearThinkingTimeouts();
			setThinkingDuration( 'short' );
		}
		return () => clearThinkingTimeouts();
	}, [ isLoading ] );

	const getPlaceholderText = () => {
		if ( placeholder ) {
			return placeholder;
		}
		if ( isLoading ) {
			switch ( thinkingDuration ) {
				case 'veryLong':
					return __( 'Stick with me...' );
				case 'long':
					return __( 'This is taking a little longer than I thought...' );
				case 'medium':
					return __( 'Still working on it...' );
				default:
					return __( 'Thinking about that...' );
			}
		}
		return __( 'Ask anything' );
	};

	const canSend = input.trim() !== '' && ! disabled && ! isLoading;

	return (
		<div
			className={ cx(
				'flex flex-col w-full max-w-3xl border rounded-[2px] bg-white transition-[border-color,box-shadow]',
				disabled
					? 'border-[#a7aaad]'
					: 'border-[#8c8f94] focus-within:border-[#3858e9] focus-within:shadow-[0_0_0_1px_#3858e9]'
			) }
		>
			{ /* Textarea row */ }
			<textarea
				ref={ inputRef }
				disabled={ disabled }
				placeholder={ getPlaceholderText() }
				className={ cx(
					'w-full px-3 pt-2 pb-1 rounded-t-[2px] border-none bg-transparent resize-none focus:outline-none text-sm leading-normal',
					disabled ? 'cursor-not-allowed opacity-30' : ''
				) }
				value={ input }
				onChange={ handleInput }
				onKeyDown={ handleKeyDownWrapper }
				rows={ 1 }
				data-testid="assistant-input-textarea"
			/>

			{ /* Bottom toolbar row - inside the input container */ }
			<div className="flex items-center justify-between px-2 pb-1.5">
				{ /* Left side - action buttons and dropdowns */ }
				<div className="flex items-center gap-1">
					{ /* Clear conversation button */ }
					<Tooltip text={ __( 'New conversation' ) }>
						<button
							type="button"
							onClick={ onClearConversation }
							className="flex items-center justify-center w-7 h-7 rounded-sm text-[#1e1e1e] hover:bg-[#f0f0f0] focus:outline-none focus-visible:shadow-[0_0_0_var(--wp-admin-border-width-focus,2px)_#3858e9] transition-colors"
							aria-label={ __( 'New conversation' ) }
						>
							<Icon icon={ plus } size={ 20 } />
						</button>
					</Tooltip>

					{ /* Divider */ }
					<div className="w-px h-5 bg-[#ddd] mx-1" />

					{ /* Agent selector (if provided) */ }
					{ agentSelector }

					{ /* Model selector (if provided) */ }
					{ modelSelector }
				</div>

				{ /* Right side - more options and send button */ }
				<div className="flex items-center gap-1">
					{ /* More options menu */ }
					<DropdownMenu
						icon={ moreVertical }
						label={ __( 'More options' ) }
						className="[&>button]:flex [&>button]:items-center [&>button]:justify-center [&>button]:w-7 [&>button]:h-7 [&>button]:min-w-0 [&>button]:rounded-sm [&>button]:text-[#1e1e1e] [&>button]:hover:bg-[#f0f0f0] [&>button]:focus:outline-none [&>button]:focus-visible:shadow-[0_0_0_var(--wp-admin-border-width-focus,2px)_#3858e9]"
						popoverProps={ { className: 'assistant-options-menu' } }
					>
						{ ( { onClose }: { onClose: () => void } ) => (
							<MenuGroup>
								{ onOpenAgentSettings && (
									<MenuItem
										onClick={ () => {
											onOpenAgentSettings();
											onClose();
										} }
									>
										{ __( 'Agent settings' ) }
									</MenuItem>
								) }
								{ onOpenSkillSettings && (
									<MenuItem
										onClick={ () => {
											onOpenSkillSettings();
											onClose();
										} }
									>
										{ __( 'Skill settings' ) }
									</MenuItem>
								) }
								{ onOpenInstructionSettings && (
									<MenuItem
										onClick={ () => {
											onOpenInstructionSettings();
											onClose();
										} }
									>
										{ __( 'Instruction settings' ) }
									</MenuItem>
								) }
							</MenuGroup>
						) }
					</DropdownMenu>

					{ /* Send button */ }
					<button
						type="button"
						onClick={ handleSend }
						disabled={ ! canSend }
						className={ cx(
							'flex items-center justify-center w-7 h-7 rounded-sm focus:outline-none transition-colors',
							canSend
								? 'bg-[#3858e9] text-white [&_svg]:fill-white hover:bg-[#2145e6] focus-visible:shadow-[inset_0_0_0_1px_white,0_0_0_var(--wp-admin-border-width-focus,2px)_#3858e9] cursor-pointer'
								: 'bg-[#f0f0f0] text-[#757575] [&_svg]:fill-[#757575] cursor-not-allowed'
						) }
						aria-label={ __( 'Send message' ) }
					>
						<Icon icon={ arrowUp } size={ 20 } />
					</button>
				</div>
			</div>
			{ /* Footer (disclaimer, etc.) */ }
			{ footer && <div className="px-2 pb-1.5 text-right">{ footer }</div> }
		</div>
	);
};

export const AssistantInput = forwardRef( UnforwardedAssistantInput );
