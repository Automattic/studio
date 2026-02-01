/**
 * Model Selector Component
 *
 * Dropdown selector for choosing between available models for an ACP agent.
 * Only shown when the agent supports model selection.
 */

import { Popover, Icon, Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { check } from '@wordpress/icons';
import { useState, useCallback, useRef, useEffect } from 'react';
import type { AcpModelInfo } from 'src/modules/acp/types';

interface ModelSelectorProps {
	availableModels: AcpModelInfo[];
	currentModelId: string;
	onModelChange: ( modelId: string ) => void;
	disabled?: boolean;
}

export function ModelSelector( {
	availableModels,
	currentModelId,
	onModelChange,
	disabled = false,
}: ModelSelectorProps ) {
	const [ isOpen, setIsOpen ] = useState( false );
	const buttonRef = useRef< HTMLButtonElement >( null );
	const containerRef = useRef< HTMLDivElement >( null );
	const hasMultipleModels = availableModels.length > 1;

	const currentModel = availableModels.find( ( m ) => m.modelId === currentModelId );

	// Close popover when clicking outside
	useEffect( () => {
		if ( ! isOpen || ! hasMultipleModels ) {
			return;
		}

		const handlePointerDown = ( event: PointerEvent ) => {
			const popoverElement = document.querySelector( '.model-selector-popover' );
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
	}, [ hasMultipleModels, isOpen ] );

	const handleSelect = useCallback(
		( modelId: string ) => {
			onModelChange( modelId );
			setIsOpen( false );
			buttonRef.current?.focus();
		},
		[ onModelChange ]
	);

	const toggleOpen = useCallback( () => {
		if ( ! disabled ) {
			setIsOpen( ( prev ) => ! prev );
		}
	}, [ disabled ] );

	// Don't render if no models available or only one model
	if ( ! hasMultipleModels ) {
		return null;
	}

	return (
		<div ref={ containerRef } className="relative">
			<Tooltip text={ __( 'Select model' ) }>
				<button
					ref={ buttonRef }
					type="button"
					onClick={ toggleOpen }
					disabled={ disabled }
					className="flex items-center gap-1 px-2 py-1.5 rounded-[2px] text-[13px] text-[#1e1e1e] hover:bg-[#f0f0f0] focus:outline-none focus-visible:shadow-[0_0_0_var(--wp-admin-border-width-focus,2px)_#3858e9] transition-colors"
					aria-haspopup="listbox"
					aria-expanded={ isOpen }
				>
					<span className="max-w-[100px] truncate">{ currentModel?.name ?? __( 'Model' ) }</span>
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
					className="model-selector-popover"
				>
					<div
						className="w-48 bg-white border border-[#8c8f94] rounded-[2px] shadow-[0_2px_6px_rgba(0,0,0,0.05)] overflow-hidden"
						role="listbox"
						aria-label={ __( 'Select model' ) }
					>
						<div className="px-3 py-1.5 text-[11px] font-medium text-[#757575] uppercase tracking-wide bg-[#f6f7f7] border-b border-[#ddd]">
							{ __( 'Models' ) }
						</div>
						{ availableModels.map( ( model ) => (
							<button
								key={ model.modelId }
								type="button"
								onClick={ () => handleSelect( model.modelId ) }
								className={ `
									w-full flex items-center gap-2 px-3 py-2 text-left transition-colors
									focus:outline-none cursor-pointer
									${ model.modelId === currentModelId ? 'bg-[#f0f0f0]' : 'hover:bg-[#f0f0f0]' }
								` }
								role="option"
								aria-selected={ model.modelId === currentModelId }
							>
								<span className="flex-1 text-[13px] text-[#1e1e1e] truncate">{ model.name }</span>
								{ model.modelId === currentModelId && (
									<span className="text-[#3858e9] shrink-0">
										<Icon icon={ check } size={ 16 } />
									</span>
								) }
							</button>
						) ) }
					</div>
				</Popover>
			) }
		</div>
	);
}

export default ModelSelector;
