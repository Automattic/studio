import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { resizeImageIfNeeded } from 'src/lib/resize-image';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { appendTaskMessage, enqueueMessage, setTaskStreaming } from 'src/stores/tasks-slice';
import type { UseAreaScreenshotReturn } from 'src/hooks/use-area-screenshot';
import type { UseElementSelectorReturn } from 'src/hooks/use-element-selector';
import type { ElementAttachment, ImageAttachment, TaskMessage } from 'src/modules/ai/types';
import type { QueuedMessage } from 'src/stores/tasks-slice';

const ACCEPTED_IMAGE_TYPES = [ 'image/png', 'image/jpeg', 'image/webp', 'image/gif' ];
const MAX_IMAGES = 5;

interface TaskChatInputProps {
	taskId: string;
	isStreaming: boolean;
	elementSelector?: UseElementSelectorReturn;
	areaScreenshot?: UseAreaScreenshotReturn;
	restoredMessage?: QueuedMessage | null;
	onRestoredConsumed?: () => void;
}

export function TaskChatInput( {
	taskId,
	isStreaming,
	elementSelector,
	areaScreenshot,
	restoredMessage,
	onRestoredConsumed,
}: TaskChatInputProps ) {
	const [ value, setValue ] = useState( '' );
	const [ images, setImages ] = useState< ImageAttachment[] >( [] );
	const [ imagePreviews, setImagePreviews ] = useState< string[] >( [] );
	const textareaRef = useRef< HTMLTextAreaElement >( null );
	const fileInputRef = useRef< HTMLInputElement >( null );
	const dispatch = useAppDispatch();
	const messages = useRootSelector( ( state ) => state.tasks.messagesByTask[ taskId ] ?? [] );

	const addImages = useCallback(
		( files: FileList | File[] ) => {
			const fileArray = Array.from( files ).filter( ( f ) =>
				ACCEPTED_IMAGE_TYPES.includes( f.type )
			);
			const remaining = MAX_IMAGES - images.length;
			const toAdd = fileArray.slice( 0, remaining );

			for ( const file of toAdd ) {
				const reader = new FileReader();
				reader.onload = async () => {
					const dataUrl = reader.result as string;
					const base64 = dataUrl.split( ',' )[ 1 ];

					// Resize if the image exceeds the API size limit
					const resized = await resizeImageIfNeeded( base64, file.type );
					const attachment: ImageAttachment = {
						data: resized.data,
						mediaType: resized.mediaType,
					};
					const previewUrl = `data:${ resized.mediaType };base64,${ resized.data }`;

					setImages( ( prev ) => [ ...prev, attachment ] );
					setImagePreviews( ( prev ) => [ ...prev, previewUrl ] );
				};
				reader.readAsDataURL( file );
			}
		},
		[ images.length ]
	);

	const removeImage = useCallback( ( index: number ) => {
		setImages( ( prev ) => prev.filter( ( _, i ) => i !== index ) );
		setImagePreviews( ( prev ) => prev.filter( ( _, i ) => i !== index ) );
	}, [] );

	// Auto-import screenshot from browser capture into image attachments
	useEffect( () => {
		if ( ! areaScreenshot?.screenshot ) {
			return;
		}
		const { data, rect } = areaScreenshot.screenshot;
		if ( ! data || ( rect.width < 10 && rect.height < 10 ) ) {
			return;
		}
		if ( images.length >= MAX_IMAGES ) {
			areaScreenshot.clearScreenshot();
			return;
		}
		const attachment: ImageAttachment = { data, mediaType: 'image/png' };
		const previewUrl = `data:image/png;base64,${ data }`;
		setImages( ( prev ) => [ ...prev, attachment ] );
		setImagePreviews( ( prev ) => [ ...prev, previewUrl ] );
		areaScreenshot.clearScreenshot();
		textareaRef.current?.focus();
	}, [ areaScreenshot?.screenshot, areaScreenshot, images.length ] );

	const selectedElements = useMemo(
		() => elementSelector?.selectedElements ?? [],
		[ elementSelector?.selectedElements ]
	);

	// Restore a queued message into the input when clicked
	useEffect( () => {
		if ( ! restoredMessage ) {
			return;
		}
		setValue( restoredMessage.text );
		if ( restoredMessage.images?.length ) {
			setImages( restoredMessage.images );
			setImagePreviews(
				restoredMessage.images.map( ( img ) => `data:${ img.mediaType };base64,${ img.data }` )
			);
		}
		onRestoredConsumed?.();
		textareaRef.current?.focus();
	}, [ restoredMessage, onRestoredConsumed ] );

	const handleSend = useCallback( () => {
		const trimmed = value.trim();
		const hasAttachments = images.length > 0 || selectedElements.length > 0;
		if ( ! trimmed && ! hasAttachments ) {
			return;
		}

		// Queue the message if the agent is busy
		if ( isStreaming ) {
			const queued: QueuedMessage = {
				id: `queued-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2, 8 ) }`,
				text: trimmed,
				...( images.length > 0 && { images: [ ...images ] } ),
				...( selectedElements.length > 0 && { elements: [ ...selectedElements ] } ),
			};
			dispatch( enqueueMessage( { taskId, message: queued } ) );
			setValue( '' );
			setImages( [] );
			setImagePreviews( [] );
			elementSelector?.clearElements();
			return;
		}

		// Build content description for display
		const parts: string[] = [];
		if ( images.length > 0 ) {
			parts.push( `${ images.length } image${ images.length > 1 ? 's' : '' }` );
		}
		if ( selectedElements.length > 0 ) {
			parts.push(
				`${ selectedElements.length } element${ selectedElements.length > 1 ? 's' : '' }`
			);
		}

		// Add user message to local state immediately
		const userMessage: TaskMessage = {
			id: `user-${ Date.now() }`,
			role: 'user',
			content: trimmed || ( parts.length > 0 ? `[Attached ${ parts.join( ' and ' ) }]` : '' ),
			timestamp: Date.now(),
			...( images.length > 0 && { images: [ ...images ] } ),
			...( selectedElements.length > 0 && { elements: [ ...selectedElements ] } ),
		};
		dispatch( appendTaskMessage( { taskId, message: userMessage } ) );
		dispatch( setTaskStreaming( { taskId, streaming: true } ) );

		const messageImages = images.length > 0 ? [ ...images ] : undefined;
		const messageElements: ElementAttachment[] | undefined =
			selectedElements.length > 0 ? [ ...selectedElements ] : undefined;
		setValue( '' );
		setImages( [] );
		setImagePreviews( [] );
		elementSelector?.clearElements();

		// Send to the agent via IPC
		const isFirstMessage = messages.length === 0;
		if ( isFirstMessage ) {
			// Set a temporary title immediately, then generate an AI title in the background
			const tempTitle = trimmed.length > 50 ? trimmed.slice( 0, 47 ) + '...' : trimmed;
			if ( tempTitle ) {
				void getIpcApi().updateTask( taskId, { title: tempTitle } );
			}
			if ( trimmed ) {
				void getIpcApi().generateTaskTitle( taskId, trimmed );
			}

			// First message — start a new agent session
			void getIpcApi().startTaskAgentHandler(
				taskId,
				trimmed,
				undefined,
				messageImages,
				messageElements
			);
		} else {
			// Follow-up — send to the existing agent
			void getIpcApi().sendTaskMessageHandler( taskId, trimmed, messageImages, messageElements );
		}
	}, [
		value,
		images,
		selectedElements,
		isStreaming,
		taskId,
		dispatch,
		messages.length,
		elementSelector,
	] );

	const handleKeyDown = ( e: React.KeyboardEvent ) => {
		if ( e.key === 'Enter' && ! e.shiftKey ) {
			e.preventDefault();
			handleSend();
		}
	};

	const handlePaste = useCallback(
		( e: React.ClipboardEvent ) => {
			const items = e.clipboardData?.items;
			if ( ! items ) {
				return;
			}

			const imageFiles: File[] = [];
			for ( const item of items ) {
				if ( ACCEPTED_IMAGE_TYPES.includes( item.type ) ) {
					const file = item.getAsFile();
					if ( file ) {
						imageFiles.push( file );
					}
				}
			}

			if ( imageFiles.length > 0 ) {
				addImages( imageFiles );
			}
		},
		[ addImages ]
	);

	const hasContent = value.trim() || images.length > 0 || selectedElements.length > 0;

	return (
		<div className="px-4 pt-1 pb-4">
			<input
				ref={ fileInputRef }
				type="file"
				accept={ ACCEPTED_IMAGE_TYPES.join( ',' ) }
				multiple
				className="hidden"
				onChange={ ( e ) => {
					if ( e.target.files ) {
						addImages( e.target.files );
					}
					e.target.value = '';
				} }
			/>

			<div className="rounded-xl task-chat-input-card">
				{ /* Image previews */ }
				{ imagePreviews.length > 0 && (
					<div className="flex gap-2 px-4 pt-3 flex-wrap">
						{ imagePreviews.map( ( preview, index ) => (
							<div key={ index } className="relative group">
								<img
									src={ preview }
									alt={ `Attachment ${ index + 1 }` }
									className="w-14 h-14 rounded-lg object-cover"
								/>
								<button
									onClick={ () => removeImage( index ) }
									className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-frame-surface border border-frame-border text-frame-text-secondary text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-frame-border"
								>
									&times;
								</button>
							</div>
						) ) }
					</div>
				) }

				{ /* Element selection chips */ }
				{ selectedElements.length > 0 && (
					<div className="flex gap-2 px-4 pt-3 flex-wrap">
						{ selectedElements.map( ( el, index ) => (
							<div
								key={ index }
								className="relative group flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs"
							>
								<span className="text-blue-400 font-mono">&lt;{ el.tagName }&gt;</span>
								<span className="text-frame-text-secondary truncate max-w-[120px]">
									{ el.textContent || el.cssSelector }
								</span>
								<button
									onClick={ () => elementSelector?.removeElement( index ) }
									className="w-4 h-4 rounded-full text-frame-text-tertiary flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-frame-text-secondary"
								>
									&times;
								</button>
							</div>
						) ) }
					</div>
				) }

				{ /* Textarea */ }
				<textarea
					ref={ textareaRef }
					value={ value }
					onChange={ ( e ) => setValue( e.target.value ) }
					onKeyDown={ handleKeyDown }
					onPaste={ handlePaste }
					placeholder={ isStreaming ? 'Queue a follow-up message...' : 'Ask the agent...' }
					rows={ 1 }
					className={ cx(
						'w-full resize-none bg-transparent px-4 pt-3 pb-1',
						'text-sm text-frame-text placeholder:text-frame-text-tertiary',
						'focus:outline-none',
						'max-h-32'
					) }
					style={ { fieldSizing: 'content' } as React.CSSProperties }
				/>

				{ /* Toolbar row */ }
				<div className="flex items-center justify-between px-2 pb-2 pt-1">
					<div className="flex items-center">
						<button
							onClick={ () => fileInputRef.current?.click() }
							disabled={ images.length >= MAX_IMAGES }
							title="Attach images"
							className={ cx(
								'w-7 h-7 flex items-center justify-center rounded-md transition-colors',
								'text-frame-text-tertiary hover:text-frame-text-secondary',
								'disabled:opacity-50 disabled:cursor-not-allowed'
							) }
						>
							<svg
								width="15"
								height="15"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
							</svg>
						</button>
					</div>

					<button
						onClick={ handleSend }
						disabled={ ! hasContent }
						className={ cx(
							'w-8 h-8 flex items-center justify-center rounded-full transition-colors',
							hasContent
								? 'bg-frame-theme text-white'
								: 'bg-frame-surface-alt text-frame-text-tertiary',
							'disabled:cursor-not-allowed'
						) }
					>
						<svg
							width="16"
							height="16"
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
