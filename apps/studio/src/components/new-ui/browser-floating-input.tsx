import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { createNewTask, appendTaskMessage, setTaskStreaming } from 'src/stores/tasks-slice';
import type { UseAreaScreenshotReturn } from 'src/hooks/use-area-screenshot';
import type { UseElementSelectorReturn } from 'src/hooks/use-element-selector';
import type { ElementAttachment, ImageAttachment, TaskMessage } from 'src/modules/ai/types';

interface BrowserFloatingInputProps {
	siteId: string;
	elementSelector: UseElementSelectorReturn;
	areaScreenshot: UseAreaScreenshotReturn;
	getActiveIframe: () => HTMLIFrameElement | null;
}

export function BrowserFloatingInput( {
	siteId,
	elementSelector,
	areaScreenshot,
	getActiveIframe,
}: BrowserFloatingInputProps ) {
	const [ value, setValue ] = useState( '' );
	const [ isSending, setIsSending ] = useState( false );
	const textareaRef = useRef< HTMLTextAreaElement >( null );
	const containerRef = useRef< HTMLDivElement >( null );
	const dispatch = useAppDispatch();

	const { selectedElements, clearElements } = elementSelector;
	const { screenshot, clearScreenshot } = areaScreenshot;
	const lastElement = selectedElements[ selectedElements.length - 1 ];

	const hasElement = !! lastElement;
	const hasScreenshot = !! screenshot;
	const hasAttachment = hasElement || hasScreenshot;

	// Calculate position near the selected element or screenshot region
	const position = useMemo( () => {
		// Position near screenshot selection
		if ( hasScreenshot && screenshot ) {
			const containerEl = containerRef.current?.parentElement;
			if ( ! containerEl ) {
				return null;
			}
			const containerRect = containerEl.getBoundingClientRect();
			const inputWidth = 320;
			const selBottom = screenshot.rect.y + screenshot.rect.height;
			const selCenterX = screenshot.rect.x + screenshot.rect.width / 2;
			const top = selBottom + 8;
			const maxLeft = containerRect.width - inputWidth - 12;
			const left = Math.max( 12, Math.min( selCenterX - inputWidth / 2, maxLeft ) );

			const containerHeight = containerRect.height;
			const estimatedInputHeight = 80;
			if ( top + estimatedInputHeight > containerHeight - 12 ) {
				const topAbove = screenshot.rect.y - estimatedInputHeight - 8;
				return { top: Math.max( 12, topAbove ), left };
			}
			return { top, left };
		}

		// Position near selected element
		if ( ! lastElement ) {
			return null;
		}

		const iframe = getActiveIframe();
		if ( ! iframe ) {
			return null;
		}

		const iframeRect = iframe.getBoundingClientRect();
		const containerEl = containerRef.current?.parentElement;
		if ( ! containerEl ) {
			return null;
		}
		const containerRect = containerEl.getBoundingClientRect();

		const elBottom =
			iframeRect.top -
			containerRect.top +
			lastElement.boundingBox.y +
			lastElement.boundingBox.height;
		const elLeft = iframeRect.left - containerRect.left + lastElement.boundingBox.x;
		const elCenterX = elLeft + lastElement.boundingBox.width / 2;

		const top = elBottom + 8;
		const inputWidth = 320;
		const maxLeft = containerRect.width - inputWidth - 12;
		const left = Math.max( 12, Math.min( elCenterX - inputWidth / 2, maxLeft ) );

		const containerHeight = containerRect.height;
		const estimatedInputHeight = 80;
		if ( top + estimatedInputHeight > containerHeight - 12 ) {
			const topAbove =
				iframeRect.top - containerRect.top + lastElement.boundingBox.y - estimatedInputHeight - 8;
			return { top: Math.max( 12, topAbove ), left };
		}

		return { top, left };
	}, [ lastElement, hasScreenshot, screenshot, getActiveIframe ] );

	// Auto-focus the textarea when attachments are present
	useEffect( () => {
		if ( hasAttachment ) {
			requestAnimationFrame( () => textareaRef.current?.focus() );
		}
	}, [ hasAttachment ] );

	const handleSend = useCallback( async () => {
		const trimmed = value.trim();
		if ( ( ! trimmed && ! hasAttachment ) || isSending ) {
			return;
		}

		setIsSending( true );

		try {
			const task = await dispatch( createNewTask( siteId ) ).unwrap();

			const parts: string[] = [];
			if ( hasElement ) {
				parts.push( '1 element' );
			}
			if ( hasScreenshot ) {
				parts.push( '1 screenshot' );
			}

			const messageImages: ImageAttachment[] | undefined = hasScreenshot
				? [ { data: screenshot!.data, mediaType: 'image/png' } ]
				: undefined;
			const messageElements: ElementAttachment[] | undefined = hasElement
				? [ ...selectedElements ]
				: undefined;

			const userMessage: TaskMessage = {
				id: `user-${ Date.now() }`,
				role: 'user',
				content: trimmed || ( parts.length > 0 ? `[Attached ${ parts.join( ' and ' ) }]` : '' ),
				timestamp: Date.now(),
				...( messageImages && { images: messageImages } ),
				...( messageElements && { elements: messageElements } ),
			};
			dispatch( appendTaskMessage( { taskId: task.id, message: userMessage } ) );
			dispatch( setTaskStreaming( { taskId: task.id, streaming: true } ) );

			const title = trimmed.length > 50 ? trimmed.slice( 0, 47 ) + '...' : trimmed;
			if ( title ) {
				void getIpcApi().updateTask( task.id, { title } );
			}
			if ( trimmed ) {
				void getIpcApi().generateTaskTitle( task.id, trimmed );
			}

			void getIpcApi().startTaskAgentHandler(
				task.id,
				trimmed,
				undefined,
				messageImages,
				messageElements
			);

			setValue( '' );
			clearElements();
			clearScreenshot();
		} finally {
			setIsSending( false );
		}
	}, [
		value,
		hasAttachment,
		hasElement,
		hasScreenshot,
		screenshot,
		selectedElements,
		isSending,
		siteId,
		dispatch,
		clearElements,
		clearScreenshot,
	] );

	const handleKeyDown = ( e: React.KeyboardEvent ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			void handleSend();
		}
		if ( e.key === 'Escape' ) {
			clearElements();
			clearScreenshot();
		}
	};

	if ( ! hasAttachment ) {
		return <div ref={ containerRef } />;
	}

	return (
		<div
			ref={ containerRef }
			className="absolute z-20"
			style={
				position
					? { top: position.top, left: position.left, width: 320 }
					: { bottom: 12, left: 12, right: 12 }
			}
		>
			<div className="rounded-xl bg-[#2c3338]/80 backdrop-blur-xl border border-white/[0.08] shadow-2xl">
				{ /* Attachment preview */ }
				<div className="flex gap-1.5 px-3 pt-2 flex-wrap items-center">
					{ hasElement &&
						selectedElements.map( ( el, index ) => (
							<div
								key={ index }
								className="group flex items-center gap-0.5 px-1 py-px rounded bg-blue-500/10 border border-blue-500/20 text-[10px] leading-tight"
							>
								<span className="text-blue-400/70 font-mono">{ el.tagName }</span>
								<button
									onClick={ () => elementSelector.removeElement( index ) }
									className="text-[#a7aaad] hover:text-white leading-none opacity-0 group-hover:opacity-100 transition-opacity"
								>
									&times;
								</button>
							</div>
						) ) }
					{ hasScreenshot && (
						<div className="group flex items-center gap-1">
							<img
								src={ `data:image/png;base64,${ screenshot!.data }` }
								alt="Selected area"
								className="h-6 rounded border border-white/10 object-cover"
							/>
							<button
								onClick={ clearScreenshot }
								className="text-[#a7aaad] hover:text-white text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
							>
								&times;
							</button>
						</div>
					) }
				</div>

				{ /* Textarea */ }
				<textarea
					ref={ textareaRef }
					value={ value }
					onChange={ ( e ) => setValue( e.target.value ) }
					onKeyDown={ handleKeyDown }
					placeholder="Describe the change..."
					disabled={ isSending }
					rows={ 1 }
					className={ cx(
						'w-full resize-none bg-transparent px-3 pt-2 pb-0.5',
						'text-xs text-[#e0e0e0] placeholder:text-[#6b7280]',
						'focus:outline-none',
						'disabled:opacity-50',
						'max-h-20'
					) }
					style={ { fieldSizing: 'content' } as React.CSSProperties }
				/>

				{ /* Send button row */ }
				<div className="flex items-center justify-end px-1.5 pb-1.5 pt-0.5">
					<button
						onClick={ () => void handleSend() }
						disabled={ ( ! value.trim() && ! hasAttachment ) || isSending }
						className={ cx(
							'w-6 h-6 flex items-center justify-center rounded-full transition-colors',
							value.trim() || hasAttachment
								? 'bg-blue-500 text-white'
								: 'bg-[#3c4349] text-[#6b7280]',
							'disabled:cursor-not-allowed disabled:opacity-50'
						) }
					>
						<svg
							width="12"
							height="12"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<line x1="12" y1="19" x2="12" y2="5" />
							<polyline points="5 12 12 5 19 12" />
						</svg>
					</button>
				</div>
			</div>
		</div>
	);
}
