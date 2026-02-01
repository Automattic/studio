/**
 * Agent Selector Component
 *
 * Dropdown selector for choosing between AI agents (WordPress.com, Built-in Anthropic, ACP agents).
 */

import { Popover, Icon, Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { check } from '@wordpress/icons';
import { useState, useCallback, useEffect, memo, useRef, useMemo } from 'react';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { agentChatSelectors, agentChatThunks } from 'src/stores/agent-chat-slice';
import { AgentIcon } from './agent-icon';
import type { AgentConfig } from 'src/modules/acp/types';

interface AgentSelectorProps {
	onAgentChange?: ( agentId: string ) => void;
	disabled?: boolean;
}

interface AgentOptionProps {
	agent: AgentConfig;
	isSelected: boolean;
	isFocused: boolean;
	onClick: () => void;
	onMouseEnter: () => void;
}

const AgentOption = memo( function AgentOption( {
	agent,
	isSelected,
	isFocused,
	onClick,
	onMouseEnter,
}: AgentOptionProps ) {
	const isUnavailable = agent.status === 'unavailable' || agent.status === 'error';
	const isAvailable = ! isUnavailable;
	const isInstalled = agent.isInstalled !== false;
	const isOnDemand = isAvailable && ! isInstalled;
	const ref = useRef< HTMLButtonElement >( null );

	// Scroll into view when focused or selected (on mount)
	useEffect( () => {
		if ( ( isFocused || isSelected ) && ref.current ) {
			ref.current.scrollIntoView( { block: 'nearest' } );
		}
	}, [ isFocused, isSelected ] );

	return (
		<button
			ref={ ref }
			type="button"
			onClick={ onClick }
			onMouseEnter={ onMouseEnter }
			disabled={ ! isAvailable }
			className={ `
				w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
				focus:outline-none
				${ isAvailable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed' }
				${ isSelected ? 'bg-[#e8f0fe] border-l-2 border-l-[#3858e9]' : '' }
				${ isFocused && ! isSelected ? 'bg-[#f0f0f0]' : '' }
				${ ! isFocused && ! isSelected ? 'hover:bg-[#f0f0f0]' : '' }
			` }
			role="option"
			aria-selected={ isSelected }
			tabIndex={ -1 }
		>
			<AgentIcon agentId={ agent.id } icon={ agent.icon } size={ 16 } />
			<div className="flex-1 min-w-0">
				<div className={ `text-[13px] truncate ${ isSelected ? 'text-[#3858e9] font-medium' : 'text-[#1e1e1e]' }` }>
					{ agent.name }
				</div>
				{ isUnavailable && (
					<div className="text-[11px] text-[#757575]">{ __( 'Not available' ) }</div>
				) }
				{ ! isUnavailable && isOnDemand && (
					<div className="text-[11px] text-[#757575]">
						{ agent.command === 'npx'
							? __( 'Not installed (runs on demand)' )
							: __( 'Not installed' ) }
					</div>
				) }
				{ isSelected && isAvailable && (
					<div className="text-[11px] text-[#3858e9]">{ __( 'Active' ) }</div>
				) }
			</div>
			{ isSelected && (
				<span className="text-[#3858e9] shrink-0">
					<Icon icon={ check } size={ 16 } />
				</span>
			) }
		</button>
	);
} );

export function AgentSelector( { onAgentChange, disabled = false }: AgentSelectorProps ) {
	const dispatch = useAppDispatch();
	const [ isOpen, setIsOpen ] = useState( false );
	const [ focusedIndex, setFocusedIndex ] = useState( -1 );
	const buttonRef = useRef< HTMLButtonElement >( null );
	const containerRef = useRef< HTMLDivElement >( null );

	const selectedAgentId = useRootSelector( agentChatSelectors.selectSelectedAgentId );
	const availableAgents = useRootSelector( agentChatSelectors.selectAvailableAgents );
	const isLoadingAgents = useRootSelector( agentChatSelectors.selectIsLoadingAgents );
	const selectedAgent = useRootSelector( agentChatSelectors.selectSelectedAgent );

	// Close popover when clicking outside
	useEffect( () => {
		if ( ! isOpen ) {
			return;
		}

		const handlePointerDown = ( event: PointerEvent ) => {
			const popoverElement = document.querySelector( '.agent-selector-popover' );
			const path = event.composedPath ? event.composedPath() : [];
			const clickedInside =
				( containerRef.current && path.includes( containerRef.current ) ) ||
				( popoverElement && path.includes( popoverElement ) );

			if ( ! clickedInside ) {
				setIsOpen( false );
			}
		};

		document.addEventListener( 'pointerdown', handlePointerDown, true );
		return () => document.removeEventListener( 'pointerdown', handlePointerDown, true );
	}, [ isOpen ] );

	// Flatten all agents into a single array for keyboard navigation
	const allAgents = useMemo( () => {
		const chatAgents = availableAgents.filter( ( a ) => a.provider === 'wpcom' );
		const builtinAgents = availableAgents.filter( ( a ) => a.provider === 'anthropic-builtin' );
		const acpAgents = availableAgents.filter( ( a ) => a.provider === 'acp' );
		return [ ...chatAgents, ...builtinAgents, ...acpAgents ];
	}, [ availableAgents ] );

	// Load available agents on mount
	useEffect( () => {
		void dispatch( agentChatThunks.loadAvailableAgents() );
	}, [ dispatch ] );

	// Reset focused index when opening
	useEffect( () => {
		if ( isOpen ) {
			const selectedIdx = allAgents.findIndex( ( a ) => a.id === selectedAgentId );
			setFocusedIndex( selectedIdx >= 0 ? selectedIdx : 0 );
		}
	}, [ isOpen, allAgents, selectedAgentId ] );

	const handleSelectAgent = useCallback(
		( agentId: string ) => {
			void dispatch( agentChatThunks.selectAgent( agentId ) );
			// Don't auto-close - let user explicitly close or click outside
			onAgentChange?.( agentId );
		},
		[ dispatch, onAgentChange ]
	);

	const toggleOpen = useCallback( () => {
		if ( ! disabled ) {
			setIsOpen( ( prev ) => ! prev );
		}
	}, [ disabled ] );

	const handleKeyDown = useCallback(
		( e: React.KeyboardEvent ) => {
			if ( ! isOpen ) {
				if ( e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ' ) {
					e.preventDefault();
					setIsOpen( true );
				}
				return;
			}

			switch ( e.key ) {
				case 'ArrowDown':
					e.preventDefault();
					setFocusedIndex( ( prev ) => ( prev < allAgents.length - 1 ? prev + 1 : 0 ) );
					break;
				case 'ArrowUp':
					e.preventDefault();
					setFocusedIndex( ( prev ) => ( prev > 0 ? prev - 1 : allAgents.length - 1 ) );
					break;
				case 'Enter':
				case ' ':
					e.preventDefault();
					if ( focusedIndex >= 0 && allAgents[ focusedIndex ] ) {
						const agent = allAgents[ focusedIndex ];
						if ( agent.status !== 'unavailable' ) {
							handleSelectAgent( agent.id );
							// Don't close - user can press Escape or click outside to close
						}
					}
					break;
				case 'Escape':
					e.preventDefault();
					setIsOpen( false );
					buttonRef.current?.focus();
					break;
				case 'Tab':
					setIsOpen( false );
					break;
			}
		},
		[ isOpen, allAgents, focusedIndex, handleSelectAgent ]
	);

	// Group agents by provider for display
	const chatAgents = availableAgents.filter( ( a ) => a.provider === 'wpcom' );
	const builtinAgents = availableAgents.filter( ( a ) => a.provider === 'anthropic-builtin' );
	const acpAgents = availableAgents.filter( ( a ) => a.provider === 'acp' );

	const displayName = selectedAgent?.name ?? __( 'Select Agent' );

	// Calculate index offset for each section
	const getGlobalIndex = ( sectionAgents: AgentConfig[], localIndex: number ) => {
		if ( sectionAgents === chatAgents ) {
			return localIndex;
		}
		if ( sectionAgents === builtinAgents ) {
			return chatAgents.length + localIndex;
		}
		return chatAgents.length + builtinAgents.length + localIndex;
	};

	return (
		<div ref={ containerRef } className="relative" onKeyDown={ handleKeyDown }>
			<Tooltip text={ __( 'Select AI agent' ) }>
				<button
					ref={ buttonRef }
					type="button"
					onClick={ toggleOpen }
					disabled={ disabled || isLoadingAgents }
					className="flex items-center gap-1.5 px-2 py-1.5 rounded-[2px] text-[13px] text-[#1e1e1e] hover:bg-[#f0f0f0] focus:outline-none focus-visible:shadow-[0_0_0_var(--wp-admin-border-width-focus,2px)_#3858e9] transition-colors"
					aria-haspopup="listbox"
					aria-expanded={ isOpen }
				>
					{ selectedAgent && (
						<AgentIcon agentId={ selectedAgent.id } icon={ selectedAgent.icon } size={ 16 } />
					) }
					<span>{ displayName }</span>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[#757575]">
						<path
							d="M3 4.5L6 7.5L9 4.5"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
			</Tooltip>

			{ isOpen && (
				<Popover
					placement="bottom-start"
					offset={ 4 }
					onClose={ () => setIsOpen( false ) }
					onFocusOutside={ () => setIsOpen( false ) }
					noArrow
					focusOnMount={ false }
					className="agent-selector-popover"
				>
					<div
						className="w-56 bg-white border border-[#8c8f94] rounded-[2px] shadow-[0_2px_6px_rgba(0,0,0,0.05)] overflow-hidden max-h-64 overflow-y-auto"
						role="listbox"
						aria-label={ __( 'Select AI agent' ) }
					>
						{ /* Chat section */ }
						{ chatAgents.length > 0 && (
							<div role="group" aria-labelledby="agent-group-chat">
								<div
									id="agent-group-chat"
									className="px-3 py-1.5 text-[11px] font-medium text-[#757575] uppercase tracking-wide bg-[#f6f7f7] border-b border-[#ddd]"
								>
									{ __( 'Chat' ) }
								</div>
								{ chatAgents.map( ( agent, idx ) => (
									<AgentOption
										key={ agent.id }
										agent={ agent }
										isSelected={ agent.id === selectedAgentId }
										isFocused={ focusedIndex === getGlobalIndex( chatAgents, idx ) }
										onClick={ () => handleSelectAgent( agent.id ) }
										onMouseEnter={ () => setFocusedIndex( getGlobalIndex( chatAgents, idx ) ) }
									/>
								) ) }
							</div>
						) }

						{ /* Built-in Agents section */ }
						{ builtinAgents.length > 0 && (
							<div role="group" aria-labelledby="agent-group-builtin">
								<div
									id="agent-group-builtin"
									className="px-3 py-1.5 text-[11px] font-medium text-[#757575] uppercase tracking-wide bg-[#f6f7f7] border-b border-t border-[#ddd]"
								>
									{ __( 'Built-in' ) }
								</div>
								{ builtinAgents.map( ( agent, idx ) => (
									<AgentOption
										key={ agent.id }
										agent={ agent }
										isSelected={ agent.id === selectedAgentId }
										isFocused={ focusedIndex === getGlobalIndex( builtinAgents, idx ) }
										onClick={ () => handleSelectAgent( agent.id ) }
										onMouseEnter={ () => setFocusedIndex( getGlobalIndex( builtinAgents, idx ) ) }
									/>
								) ) }
							</div>
						) }

						{ /* ACP Agents section */ }
						{ acpAgents.length > 0 && (
							<div role="group" aria-labelledby="agent-group-acp">
								<div
									id="agent-group-acp"
									className="px-3 py-1.5 text-[11px] font-medium text-[#757575] uppercase tracking-wide bg-[#f6f7f7] border-b border-t border-[#ddd]"
								>
									{ __( 'Agents' ) }
								</div>
								{ acpAgents.map( ( agent, idx ) => (
									<AgentOption
										key={ agent.id }
										agent={ agent }
										isSelected={ agent.id === selectedAgentId }
										isFocused={ focusedIndex === getGlobalIndex( acpAgents, idx ) }
										onClick={ () => handleSelectAgent( agent.id ) }
										onMouseEnter={ () => setFocusedIndex( getGlobalIndex( acpAgents, idx ) ) }
									/>
								) ) }
							</div>
						) }

						{ /* Empty state */ }
						{ availableAgents.length === 0 && ! isLoadingAgents && (
							<div className="px-3 py-4 text-[13px] text-[#757575] text-center">
								{ __( 'No agents available' ) }
							</div>
						) }

						{ /* Loading state */ }
						{ isLoadingAgents && (
							<div className="px-3 py-4 text-[13px] text-[#757575] text-center">
								{ __( 'Loading agents...' ) }
							</div>
						) }
					</div>
				</Popover>
			) }
		</div>
	);
}

export default AgentSelector;
