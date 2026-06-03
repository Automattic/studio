import {
	STUDIO_CHAT_IMAGE_MIME_TYPES,
	STUDIO_CHAT_MAX_IMAGES,
	STUDIO_CHAT_MAX_IMAGE_BYTES,
	isStudioChatImageMimeType,
	validateStudioChatImages,
} from '@studio/common/ai/chat-images';
import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall, closeSmall, image as imageIcon } from '@wordpress/icons';
import { Icon, Tooltip } from '@wordpress/ui';
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
} from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { getMessageSendShortcutLabel, shouldSendMessageForKeyDown } from '@/lib/keyboard-shortcuts';
import { EnvironmentPill } from './environment-pill';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import type {
	AiModelId,
	LoadedAiSession,
	SessionEntry,
	StudioChatImage,
	SyncSite,
} from '@/data/core';

const IMAGE_ACCEPT = STUDIO_CHAT_IMAGE_MIME_TYPES.join( ',' );

interface ComposerImageAttachment extends StudioChatImage {
	previewUrl: string;
}

function getMimeTypeForImageFile( file: File ) {
	if ( isStudioChatImageMimeType( file.type ) ) {
		return file.type;
	}
	const lowerName = file.name.toLowerCase();
	if ( lowerName.endsWith( '.png' ) ) {
		return 'image/png';
	}
	if ( lowerName.endsWith( '.jpg' ) || lowerName.endsWith( '.jpeg' ) ) {
		return 'image/jpeg';
	}
	return undefined;
}

function readFileAsDataUrl( file: File ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onload = () => {
			if ( typeof reader.result === 'string' ) {
				resolve( reader.result );
				return;
			}
			reject( new Error( __( 'Unable to read the selected image.' ) ) );
		};
		reader.onerror = () => reject( new Error( __( 'Unable to read the selected image.' ) ) );
		reader.readAsDataURL( file );
	} );
}

function readImageDimensions(
	src: string
): Promise< { width: number; height: number } | undefined > {
	return new Promise( ( resolve ) => {
		const image = new Image();
		image.onload = () =>
			resolve( {
				width: image.naturalWidth,
				height: image.naturalHeight,
			} );
		image.onerror = () => resolve( undefined );
		image.src = src;
	} );
}

function fileListToArray( files: FileList | null | undefined ) {
	return files ? Array.from( files ) : [];
}

function getImageFilesFromDataTransfer( dataTransfer: DataTransfer ) {
	return fileListToArray( dataTransfer.files ).filter(
		( file ) => !! getMimeTypeForImageFile( file )
	);
}

const PLACEHOLDER_ROTATION_DELAY_MS = 4400;
const PLACEHOLDER_TYPE_START_DELAY_MS = 90;
const PLACEHOLDER_TYPE_INTERVAL_MS = 22;
const SHELL_FOCUS_INTERACTIVE_TARGETS = [
	'button',
	'a',
	'input',
	'textarea',
	'select',
	'[contenteditable="true"]',
	'[role="button"]',
	'[role="menuitem"]',
	'[role="menuitemcheckbox"]',
	'[role="menuitemradio"]',
	'[role="option"]',
].join( ',' );
const SHELL_FOCUS_CONTROL_TARGETS = [
	'button',
	'a',
	'[role="button"]',
	'[role="menuitem"]',
	'[role="menuitemcheckbox"]',
	'[role="menuitemradio"]',
	'[role="option"]',
].join( ',' );
const SHELL_FOCUS_CONTROL_PROXIMITY_PX = 8;

function isPointerNearControl( event: ReactMouseEvent< HTMLDivElement >, control: Element ) {
	const rect = control.getBoundingClientRect();
	if ( rect.width === 0 && rect.height === 0 ) {
		return false;
	}
	return (
		event.clientX >= rect.left - SHELL_FOCUS_CONTROL_PROXIMITY_PX &&
		event.clientX <= rect.right + SHELL_FOCUS_CONTROL_PROXIMITY_PX &&
		event.clientY >= rect.top - SHELL_FOCUS_CONTROL_PROXIMITY_PX &&
		event.clientY <= rect.bottom + SHELL_FOCUS_CONTROL_PROXIMITY_PX
	);
}

function shouldShellMouseDownFocusTextarea( event: ReactMouseEvent< HTMLDivElement > ) {
	if ( event.button !== 0 ) {
		return false;
	}
	const target = event.target;
	if ( target instanceof Element && target.closest( SHELL_FOCUS_INTERACTIVE_TARGETS ) ) {
		return false;
	}
	return ! Array.from( event.currentTarget.querySelectorAll( SHELL_FOCUS_CONTROL_TARGETS ) ).some(
		( control ) => isPointerNearControl( event, control )
	);
}

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function useTypedPlaceholder( phrases: string[], paused: boolean ) {
	const [ placeholder, setPlaceholder ] = useState( () => phrases[ 0 ] ?? '' );

	useEffect( () => {
		const firstPhrase = phrases[ 0 ] ?? '';

		if ( paused || phrases.length < 2 || prefersReducedMotion() ) {
			setPlaceholder( firstPhrase );
			return;
		}

		let cancelled = false;
		let timeoutId: ReturnType< typeof setTimeout > | undefined;
		let phraseIndex = 0;

		const schedule = ( callback: () => void, delay: number ) => {
			timeoutId = setTimeout( callback, delay );
		};

		const typePhrase = ( nextPhraseIndex: number ) => {
			if ( cancelled ) {
				return;
			}

			const phrase = phrases[ nextPhraseIndex ] ?? firstPhrase;
			let characterIndex = 0;
			setPlaceholder( '' );

			const typeNextCharacter = () => {
				if ( cancelled ) {
					return;
				}

				characterIndex += 1;
				setPlaceholder( phrase.slice( 0, characterIndex ) );

				if ( characterIndex < phrase.length ) {
					schedule( typeNextCharacter, PLACEHOLDER_TYPE_INTERVAL_MS );
					return;
				}

				phraseIndex = nextPhraseIndex;
				schedule( () => {
					typePhrase( ( phraseIndex + 1 ) % phrases.length );
				}, PLACEHOLDER_ROTATION_DELAY_MS );
			};

			schedule( typeNextCharacter, PLACEHOLDER_TYPE_START_DELAY_MS );
		};

		setPlaceholder( firstPhrase );
		schedule( () => typePhrase( 1 ), PLACEHOLDER_ROTATION_DELAY_MS );

		return () => {
			cancelled = true;
			if ( timeoutId ) {
				clearTimeout( timeoutId );
			}
		};
	}, [ paused, phrases ] );

	return placeholder;
}

function ComposerTooltip( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Tooltip.Trigger render={ children } />
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

function TooltipMenuTrigger( {
	label,
	children,
}: {
	label: string;
	children: ReactElement< Record< string, unknown > >;
} ) {
	return (
		<Tooltip.Provider delay={ 0 }>
			<Tooltip.Root>
				<Menu.Trigger render={ <Tooltip.Trigger render={ children } /> } />
				<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>{ label }</Tooltip.Popup>
			</Tooltip.Root>
		</Tooltip.Provider>
	);
}

/**
 * Invisible structural placeholder that mirrors Composer's outer DOM (shell +
 * textarea + toolbar + meta row) so the loading state can reserve the exact
 * same vertical space without rendering a visible composer. Heights track the
 * real composer's CSS automatically — no magic numbers that drift when the
 * composer changes.
 */
export function ComposerSkeleton() {
	return (
		<div className={ styles.root } style={ { visibility: 'hidden' } } aria-hidden="true">
			<div className={ styles.shell }>
				<textarea className={ styles.input } rows={ 2 } disabled tabIndex={ -1 } />
				<div className={ styles.toolbar }>
					<span className={ styles.pill } />
				</div>
			</div>
			<div className={ styles.meta }>{ ' ' }</div>
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	error: string | null;
	model: AiModelId;
	onModelChange?: ( model: AiModelId ) => void;
	onSend: (
		prompt: string,
		options?: { displayMessage?: string; images?: StudioChatImage[] }
	) => Promise< void >;
	onInterrupt: () => Promise< void >;
	// Environment pill: only rendered when both a `sessionId` and a linked
	// `liveSite` are available. Without a live link the pill is hidden
	// entirely (there'd be nothing to flip to).
	sessionId?: string;
	effectiveEnvironment?: 'local' | 'live';
	liveSite?: SyncSite;
	entries?: SessionEntry[];
	// Local owner site id, when the session is anchored to one. Required to
	// spin up a fresh session via `connector.createSession` on a confirmed
	// family swap; if absent we fall back to the in-place model change so the
	// dropdown still works for unowned sessions.
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	autoFocus?: boolean;
}

/**
 * Imperative API surfaced via the Composer's forwarded ref. Lets parents
 * (e.g. the annotate-toolbar hand-off) inject a draft without making the
 * value a controlled prop — the latter would re-render the entire
 * SessionView (and the heavy Conversation tree) on every keystroke.
 */
export interface ComposerHandle {
	appendDraft( text: string ): void;
}

export const Composer = forwardRef< ComposerHandle, ComposerProps >( function Composer(
	{
		busy,
		isInterrupting = false,
		error,
		model,
		onModelChange,
		onSend,
		onInterrupt,
		sessionId,
		effectiveEnvironment = 'local',
		liveSite,
		entries,
		ownerSiteId,
		onSwitchSession,
		autoFocus = false,
	},
	ref
) {
	const [ value, setValue ] = useState( '' );
	const [ attachments, setAttachments ] = useState< ComposerImageAttachment[] >( [] );
	const [ attachmentError, setAttachmentError ] = useState< string | null >( null );
	const [ isDraggingImage, setIsDraggingImage ] = useState( false );
	const [ modelMenuOpen, setModelMenuOpen ] = useState( false );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: preferences } = useUserPreferences();
	const changePlaceholder = __( 'Describe the next change for this site…' );
	const pagePlaceholder = __( 'Ask Studio to update a page…' );
	const buildPlaceholder = __( 'Tell Studio what to build next…' );
	const tweakPlaceholder = __( 'Queue a tweak, fix, or idea…' );
	const idlePlaceholders = useMemo(
		() => [ changePlaceholder, pagePlaceholder, buildPlaceholder, tweakPlaceholder ],
		[ changePlaceholder, pagePlaceholder, buildPlaceholder, tweakPlaceholder ]
	);
	const typedPlaceholder = useTypedPlaceholder(
		idlePlaceholders,
		busy || value.length > 0 || attachments.length > 0
	);

	// Cross-family swap state. We hold the picked model here while the
	// confirmation dialog is open; nothing is persisted until the user
	// confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	useEffect( () => {
		if ( autoFocus ) {
			textareaRef.current?.focus();
		}
	}, [ autoFocus, sessionId ] );

	useImperativeHandle(
		ref,
		() => ( {
			appendDraft( text ) {
				if ( ! text ) return;
				setValue( ( current ) =>
					current.trim() ? `${ current.trimEnd() }\n\n${ text }` : text
				);
				// Defer focus to the next paint so the textarea reflects the
				// new value before we move the caret to the end.
				queueMicrotask( () => {
					const node = textareaRef.current;
					if ( ! node ) return;
					node.focus();
					const len = node.value.length;
					node.setSelectionRange( len, len );
				} );
			},
		} ),
		[]
	);

	const createAttachment = useCallback(
		async ( file: File ): Promise< ComposerImageAttachment > => {
			const mimeType = getMimeTypeForImageFile( file );
			if ( ! mimeType ) {
				throw new Error( __( 'Only PNG and JPEG images can be attached.' ) );
			}
			if ( file.size > STUDIO_CHAT_MAX_IMAGE_BYTES ) {
				throw new Error( __( 'Attached images must be 5 MB or smaller.' ) );
			}
			const previewUrl = await readFileAsDataUrl( file );
			const dataBase64 = previewUrl.split( ',', 2 )[ 1 ];
			if ( ! dataBase64 ) {
				throw new Error( __( 'Unable to read the selected image.' ) );
			}
			const dimensions = await readImageDimensions( previewUrl );
			const attachment: ComposerImageAttachment = {
				id: `${ Date.now().toString( 36 ) }-${ Math.random().toString( 36 ).slice( 2, 10 ) }`,
				name: file.name || __( 'Attached image' ),
				mimeType,
				size: file.size,
				width: dimensions?.width,
				height: dimensions?.height,
				dataBase64,
				previewUrl,
			};
			validateStudioChatImages( [ attachment ] );
			return attachment;
		},
		[]
	);

	const addImageFiles = useCallback(
		async ( files: File[] ) => {
			if ( files.length === 0 ) {
				return;
			}
			setAttachmentError( null );
			try {
				if ( attachments.length + files.length > STUDIO_CHAT_MAX_IMAGES ) {
					throw new Error( __( 'You can attach up to 4 images.' ) );
				}
				const nextAttachments = await Promise.all( files.map( createAttachment ) );
				validateStudioChatImages( [ ...attachments, ...nextAttachments ] );
				setAttachments( ( current ) => [ ...current, ...nextAttachments ] );
				textareaRef.current?.focus();
			} catch ( error ) {
				setAttachmentError( error instanceof Error ? error.message : String( error ) );
			}
		},
		[ attachments, createAttachment ]
	);

	const removeAttachment = useCallback( ( id: string ) => {
		setAttachments( ( current ) => current.filter( ( attachment ) => attachment.id !== id ) );
		setAttachmentError( null );
	}, [] );

	const handleShellMouseDown = useCallback( ( event: ReactMouseEvent< HTMLDivElement > ) => {
		if ( shouldShellMouseDownFocusTextarea( event ) ) {
			event.preventDefault();
			textareaRef.current?.focus();
		}
	}, [] );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed && attachments.length === 0 ) {
			return;
		}
		const prompt =
			trimmed ||
			( attachments.length === 1
				? __( 'Please review the attached image.' )
				: __( 'Please review the attached images.' ) );
		const attachmentsToSend = attachments;
		setValue( '' );
		setAttachments( [] );
		setAttachmentError( null );
		try {
			await onSend( prompt, {
				images:
					attachmentsToSend.length > 0
						? attachmentsToSend.map( ( { previewUrl: _previewUrl, ...attachment } ) => attachment )
						: undefined,
			} );
		} catch {
			// Restore the draft so the user can retry; the parent surfaces the
			// error message via `error`. Queued sends never throw from onSend
			// (the parent swallows the failure and clears the queue instead),
			// so this path only trips for direct sends from the idle state.
			setValue( trimmed );
			setAttachments( attachmentsToSend );
		}
	}, [ attachments, value, onSend ] );

	// Same-family swap: optimistic `model_change` entry; refetch on write fail.
	const applySameFamilyModel = useCallback(
		( picked: AiModelId ) => {
			if ( ! sessionId ) {
				return;
			}
			const timestamp = new Date().toISOString();
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) =>
					prev
						? {
								...prev,
								entries: [
									...( prev.entries ?? [] ),
									{
										type: 'model_change',
										id: Math.random().toString( 36 ).slice( 2, 10 ),
										parentId: null,
										timestamp,
										provider: '',
										modelId: picked,
									} as unknown as SessionEntry,
								],
						  }
						: prev
			);
			void connector.setSessionModel( sessionId, picked ).catch( () => {
				void queryClient.invalidateQueries( {
					queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
				} );
			} );
		},
		[ connector, queryClient, sessionId ]
	);

	const handleModelChange = useCallback(
		( picked: AiModelId ) => {
			if ( picked === model ) {
				return;
			}
			if ( ! sessionId ) {
				onModelChange?.( picked );
				return;
			}
			// Cross-family switch: defer until the user confirms in the dialog
			// — the runtimes don't share a transcript, so continuing the same
			// JSONL across families would make the on-screen history disagree
			// with the agent's actual memory. We skip the prompt when the
			// session has no user turns yet, or when the parent cannot switch
			// to a freshly created session.
			const hasTurns = ( entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			);
			if (
				getAiModelFamily( model ) !== getAiModelFamily( picked ) &&
				onSwitchSession &&
				hasTurns
			) {
				setPendingFamilyChange( picked );
				return;
			}
			applySameFamilyModel( picked );
		},
		[ applySameFamilyModel, entries, model, onModelChange, onSwitchSession, sessionId ]
	);
	const handleModelValueChange = useCallback(
		( value: string ) => {
			handleModelChange( value as AiModelId );
			setModelMenuOpen( false );
		},
		[ handleModelChange ]
	);

	const cancelFamilyChange = useCallback( () => {
		if ( familySwitchInFlight ) {
			return;
		}
		setPendingFamilyChange( null );
	}, [ familySwitchInFlight ] );

	const confirmFamilyChange = useCallback( async () => {
		if ( ! pendingFamilyChange || ! onSwitchSession ) {
			return;
		}
		setFamilySwitchInFlight( true );
		try {
			const newSession = await connector.createSession( ownerSiteId );
			// Persist the model on the fresh session before navigating so the
			// composer there opens already on the picked family —
			// `setSessionModel` writes a `session.model_selected` event the
			// new view picks up via `resolveSessionModel`. If this fails we
			// still navigate; the user can re-pick from the new view's
			// dropdown.
			await connector
				.setSessionModel( newSession.id, pendingFamilyChange )
				.catch( () => undefined );
			await queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, onSwitchSession, ownerSiteId, pendingFamilyChange, queryClient ] );

	const canSend = value.trim().length > 0 || attachments.length > 0;
	const placeholder = busy ? __( 'Queue a follow-up instruction…' ) : typedPlaceholder;
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const messageSendShortcut = preferences?.messageSendShortcut;
	const sendShortcutLabel = getMessageSendShortcutLabel( messageSendShortcut );
	const sendTitle = `${ sendAriaLabel } (${ sendShortcutLabel })`;
	const attachImageLabel = __( 'Attach image' );
	const skillsLabel = __( 'Skills' );
	const modelLabel = getAiModelLabel( model );
	const modelTooltipLabel = sprintf( __( 'Model: %s' ), modelLabel );
	const visibleError = attachmentError ?? error;

	return (
		<>
			<div className={ styles.root }>
				<div
					className={ styles.shell }
					data-dragging-image={ isDraggingImage ? 'true' : 'false' }
					onMouseDown={ handleShellMouseDown }
					onDragOver={ ( event ) => {
						const files = getImageFilesFromDataTransfer( event.dataTransfer );
						if ( files.length === 0 ) {
							return;
						}
						event.preventDefault();
						setIsDraggingImage( true );
					} }
					onDragLeave={ () => setIsDraggingImage( false ) }
					onDrop={ ( event ) => {
						const files = getImageFilesFromDataTransfer( event.dataTransfer );
						if ( files.length === 0 ) {
							return;
						}
						event.preventDefault();
						setIsDraggingImage( false );
						void addImageFiles( files );
					} }
				>
					{ attachments.length > 0 ? (
						<div className={ styles.attachments } aria-label={ __( 'Attached images' ) }>
							{ attachments.map( ( attachment ) => (
								<div
									key={ attachment.id }
									className={ styles.attachment }
									title={ attachment.name }
								>
									<img
										className={ styles.attachmentImage }
										src={ attachment.previewUrl }
										alt={ attachment.name }
										draggable={ false }
									/>
									<button
										type="button"
										className={ styles.removeAttachment }
										aria-label={ `${ __( 'Remove' ) } ${ attachment.name }` }
										title={ `${ __( 'Remove' ) } ${ attachment.name }` }
										onClick={ () => removeAttachment( attachment.id ) }
									>
										<Icon icon={ closeSmall } size={ 14 } />
									</button>
								</div>
							) ) }
						</div>
					) : null }
					<textarea
						ref={ textareaRef }
						className={ styles.input }
						placeholder={ placeholder }
						value={ value }
						onChange={ ( event ) => setValue( event.target.value ) }
						onKeyDown={ ( event ) => {
							// Let an active IME composition commit/cancel without sending
							// the message or interrupting the run.
							if ( event.nativeEvent.isComposing ) {
								return;
							}
							if ( event.key === 'Escape' && busy ) {
								event.preventDefault();
								void onInterrupt();
								return;
							}
							if ( shouldSendMessageForKeyDown( event.nativeEvent, messageSendShortcut ) ) {
								event.preventDefault();
								void send();
							}
						} }
						onPaste={ ( event ) => {
							const files = getImageFilesFromDataTransfer( event.clipboardData );
							if ( files.length === 0 ) {
								return;
							}
							event.preventDefault();
							void addImageFiles( files );
						} }
						rows={ 2 }
					/>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<ComposerTooltip label={ attachImageLabel }>
								<button
									type="button"
									className={ styles.iconButton }
									aria-label={ attachImageLabel }
									onClick={ () => fileInputRef.current?.click() }
								>
									<Icon icon={ imageIcon } size={ 14 } />
								</button>
							</ComposerTooltip>
							<input
								ref={ fileInputRef }
								type="file"
								accept={ IMAGE_ACCEPT }
								multiple
								className={ styles.fileInput }
								onChange={ ( event ) => {
									void addImageFiles( fileListToArray( event.target.files ) );
									event.target.value = '';
								} }
							/>
							<Menu.Root modal={ false }>
								<TooltipMenuTrigger label={ skillsLabel }>
									<button
										type="button"
										className={ `${ styles.iconButton } ${ styles.glyphButton }` }
										aria-label={ skillsLabel }
									>
										/
									</button>
								</TooltipMenuTrigger>
								<Menu.Popup side="top" align="start" className={ styles.commandsMenuPopup }>
									{ AI_SKILL_COMMANDS.map( ( command ) => (
										<Menu.Item
											key={ command.name }
											onClick={ () => {
												void onSend( `/${ command.name }` );
											} }
										>
											<span className={ styles.commandItem }>
												<span className={ styles.commandName }>/{ command.name }</span>
												<span className={ styles.commandDescription }>{ command.description }</span>
											</span>
										</Menu.Item>
									) ) }
								</Menu.Popup>
							</Menu.Root>
						</div>
						<div className={ styles.rightActions }>
							{ sessionId && liveSite ? (
								<EnvironmentPill
									sessionId={ sessionId }
									effectiveEnvironment={ effectiveEnvironment }
									liveSite={ liveSite }
									disabled={ busy }
								/>
							) : null }
							<Menu.Root modal={ false } open={ modelMenuOpen } onOpenChange={ setModelMenuOpen }>
								<TooltipMenuTrigger label={ modelTooltipLabel }>
									<button
										type="button"
										className={ styles.pill }
										aria-label={ __( 'Select model' ) }
									>
										<span>{ modelLabel }</span>
										<Icon icon={ chevronDownSmall } size={ 16 } />
									</button>
								</TooltipMenuTrigger>
								<Menu.Popup side="top" align="end">
									<Menu.RadioGroup value={ model } onValueChange={ handleModelValueChange }>
										{ AI_MODELS.map( ( { id, label } ) => (
											<Menu.RadioItem key={ id } value={ id }>
												{ label }
											</Menu.RadioItem>
										) ) }
									</Menu.RadioGroup>
								</Menu.Popup>
							</Menu.Root>
							{ busy ? (
								<button
									type="button"
									className={ styles.stopButton }
									onClick={ () => void onInterrupt() }
									aria-label={ isInterrupting ? __( 'Stopping' ) : __( 'Stop' ) }
									aria-busy={ isInterrupting }
									title={
										isInterrupting ? __( 'Stopping… click again to force stop' ) : __( 'Stop' )
									}
								>
									<span className={ styles.stopGlyph } aria-hidden="true" />
								</button>
							) : null }
							<Tooltip.Provider delay={ 0 }>
								<Tooltip.Root>
									<Tooltip.Trigger
										render={
											<button
												type="button"
												className={ styles.sendButton }
												onClick={ () => void send() }
												disabled={ ! canSend }
												aria-label={ sendAriaLabel }
											/>
										}
									>
										<Icon icon={ arrowUp } size={ 18 } />
									</Tooltip.Trigger>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ sendTitle }
									</Tooltip.Popup>
								</Tooltip.Root>
							</Tooltip.Provider>
						</div>
					</div>
				</div>
				<div className={ styles.meta }>
					{ visibleError ? <span className={ styles.error }>{ visibleError }</span> : null }
					<span className={ styles.metaUses }>{ __( 'Uses 1 message' ) }</span>
				</div>
			</div>
			<FamilySwitchConfirmDialog
				currentModel={ model }
				pendingModel={ pendingFamilyChange }
				inFlight={ familySwitchInFlight }
				onCancel={ cancelFamilyChange }
				onConfirm={ () => void confirmFamilyChange() }
			/>
		</>
	);
} );
