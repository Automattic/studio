import {
	formatComposerAttachmentSize,
	getComposerAttachmentHoverPreviewPosition,
	getComposerAttachmentImageSrc,
	getComposerAttachmentTextPreview,
	getComposerAttachmentTypeDescription,
	getComposerAttachmentTypeLabel,
	hasComposerAttachmentVisualPreview,
	watchComposerAttachmentTextScroll,
	type ComposerAttachmentHoverPreviewState,
} from '@studio/common/ai/composer-attachment-preview';
import { watchComposerFilePaste } from '@studio/common/ai/composer-attachments';
import { getAiModelFamily, getAiModelLabel, getVisibleAiModels } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { isAutomatticianEmail } from '@studio/common/lib/automattician';
import { useQueryClient } from '@tanstack/react-query';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall, closeSmall, page } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type SetStateAction,
} from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import * as Menu from '../menu';
import { SESSIONS_QUERY_KEY } from '../use-session';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import {
	toComposerSendAttachments,
	useComposerAttachments,
	type ComposerAttachment,
	type ComposerSendAttachments,
} from './use-composer-attachments';
import { useSlashCommands } from './use-slash-commands';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

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
			<div className={ styles.meta }> </div>
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	error: string | null;
	usageCapMessage?: string | null;
	model: AiModelId;
	onSend: ( prompt: string, attachments: ComposerSendAttachments ) => Promise< void >;
	onInterrupt: () => Promise< void >;
	sessionId?: string;
	entries?: SessionEntry[];
	// Local owner site id, when the session is anchored to one. Required to
	// spin up a fresh session via `createAiSession` on a confirmed family
	// swap; if absent we fall back to the in-place model change so the
	// dropdown still works for unowned sessions.
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	// Populates (but does not send) the textarea, e.g. when the user clicks an
	// example prompt on an empty conversation. The `id` lets us re-apply the
	// same prompt text more than once.
	draftPrompt?: { id: number; prompt: string } | null;
	// Temporarily previews a prompt in the textarea (muted) without committing
	// it to the draft, e.g. while hovering an example prompt. Clearing it
	// restores whatever the user had typed.
	previewPrompt?: string | null;
}

const isMacPlatform =
	typeof navigator !== 'undefined' && /mac/i.test( navigator.platform || navigator.userAgent );

// @wordpress/icons has no paperclip; this matches the others' 24×24 viewBox.
const paperclipIcon = (
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" aria-hidden="true">
		<path
			d="M16.5 6.5 9 14a2 2 0 1 0 2.8 2.8l7-7a4 4 0 1 0-5.6-5.6l-7 7a6 6 0 0 0 8.5 8.5l5.3-5.3"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

function AttachmentHoverTextPreview( { text }: { text: string } ) {
	const viewportRef = useRef< HTMLDivElement | null >( null );
	const textRef = useRef< HTMLPreElement | null >( null );

	useLayoutEffect( () => {
		return watchComposerAttachmentTextScroll( viewportRef.current, textRef.current );
	}, [ text ] );

	return (
		<div className={ styles.attachmentHoverTextViewport } aria-hidden="true" ref={ viewportRef }>
			<pre className={ styles.attachmentHoverText } ref={ textRef }>
				{ text }
			</pre>
		</div>
	);
}

function getDraftStorageKey( sessionId: string | undefined ): string | null {
	return sessionId ? `studio_code_session_draft:${ sessionId }` : null;
}

function renderAttachmentVisual(
	attachment: ComposerAttachment,
	variant: 'tile' | 'hover',
	fallbackTypeLabel: string,
	imageAlt = ''
) {
	const isHover = variant === 'hover';
	const imageClassName = isHover ? styles.attachmentHoverImage : styles.attachmentPreviewImage;
	const imageProps = imageAlt ? { alt: imageAlt } : { alt: '', 'aria-hidden': true };
	const imageSrc = getComposerAttachmentImageSrc( attachment );

	if ( imageSrc ) {
		return <img className={ imageClassName } src={ imageSrc } { ...imageProps } />;
	}

	const textPreview = getComposerAttachmentTextPreview( attachment );
	if ( textPreview ) {
		if ( isHover ) {
			return <AttachmentHoverTextPreview text={ textPreview } />;
		}

		return (
			<pre className={ styles.attachmentPreviewText } aria-hidden="true">
				{ textPreview }
			</pre>
		);
	}

	return (
		<span className={ styles.attachmentPreviewFallback } aria-hidden="true">
			<Icon icon={ page } size={ 18 } />
			<span>{ getComposerAttachmentTypeLabel( attachment.name, fallbackTypeLabel ) }</span>
		</span>
	);
}

function getAttachmentDetailsId( attachmentId: string ): string {
	return `composer-attachment-details-${ attachmentId }`;
}

function loadDraft( storageKey: string | null ): string {
	if ( ! storageKey ) {
		return '';
	}
	try {
		return localStorage.getItem( storageKey ) ?? '';
	} catch {
		return '';
	}
}

function saveDraft( storageKey: string | null, value: string ): void {
	if ( ! storageKey ) {
		return;
	}
	try {
		if ( value ) {
			localStorage.setItem( storageKey, value );
		} else {
			localStorage.removeItem( storageKey );
		}
	} catch {
		// Ignore storage errors.
	}
}

export function clearSessionDraft( sessionId: string | undefined ): void {
	saveDraft( getDraftStorageKey( sessionId ), '' );
}

function getIdlePlaceholderOptions(): string[] {
	return [
		__( 'What should we make better?' ),
		__( 'What’s the next move?' ),
		__( 'Tell me what to change next…' ),
		__( 'Drop the next idea here…' ),
		__( 'What are we tuning now?' ),
	];
}

/**
 * Pick a placeholder for the session. The choice is derived from the session id
 * so it stays stable for the lifetime of a chat instead of changing on every
 * render, while still varying between chats.
 */
function getSessionPlaceholder( sessionId: string | undefined ): string {
	const options = getIdlePlaceholderOptions();
	if ( ! sessionId ) {
		return options[ 0 ];
	}
	let hash = 0;
	for ( let i = 0; i < sessionId.length; i++ ) {
		hash = ( hash * 31 + sessionId.charCodeAt( i ) ) | 0;
	}
	return options[ Math.abs( hash ) % options.length ];
}

export function Composer( {
	busy,
	isInterrupting = false,
	error,
	usageCapMessage,
	model,
	onSend,
	onInterrupt,
	sessionId,
	entries,
	ownerSiteId,
	onSwitchSession,
	draftPrompt,
	previewPrompt,
}: ComposerProps ) {
	const draftStorageKey = getDraftStorageKey( sessionId );
	const [ value, setValue ] = useState( () => loadDraft( draftStorageKey ) );
	const [ hoverPreview, setHoverPreview ] = useState< ComposerAttachmentHoverPreviewState | null >(
		null
	);
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const appliedDraftPromptIdRef = useRef< number | null >( null );
	const queryClient = useQueryClient();
	const setDraftValue = useCallback(
		( nextValue: SetStateAction< string > ) => {
			setValue( ( previousValue ) => {
				const resolvedValue =
					typeof nextValue === 'function' ? nextValue( previousValue ) : nextValue;
				saveDraft( draftStorageKey, resolvedValue );
				return resolvedValue;
			} );
		},
		[ draftStorageKey ]
	);

	// File/image attachments (attach button + drag-and-drop). Images ride as
	// base64 content blocks; other files are referenced by disk path.
	const {
		attachments,
		error: attachmentError,
		isDraggingOver,
		addFiles,
		removeAttachment,
		clear: clearAttachments,
		restore: restoreAttachments,
		dragHandlers,
		pasteHandlers,
	} = useComposerAttachments();

	useEffect( () => {
		if ( ! draftPrompt || appliedDraftPromptIdRef.current === draftPrompt.id ) {
			return;
		}
		appliedDraftPromptIdRef.current = draftPrompt.id;
		setDraftValue( draftPrompt.prompt );
		queueMicrotask( () => {
			const node = textareaRef.current;
			if ( ! node ) {
				return;
			}
			node.focus();
			const length = node.value.length;
			node.setSelectionRange( length, length );
		} );
	}, [ draftPrompt, setDraftValue ] );

	useEffect( () => {
		setValue( loadDraft( draftStorageKey ) );
	}, [ draftStorageKey ] );

	useEffect( () => {
		return watchComposerFilePaste( ( files ) => {
			void addFiles( files );
			textareaRef.current?.focus();
		} );
	}, [ addFiles ] );

	// Inline slash-command autocomplete (popup, keyboard nav, ARIA wiring, and
	// the toolbar "/" toggle). Kept in its own hook so the Composer stays lean.
	const slash = useSlashCommands( { value, setValue: setDraftValue, textareaRef, previewPrompt } );

	// Cross-family swap state. We hold the picked model here while the
	// confirmation dialog is open; nothing is persisted until the user
	// confirms.
	const { user } = useAuth();
	const visibleModels = getVisibleAiModels( isAutomatticianEmail( user?.email ), model );
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		// Allow sending attachments on their own; fall back to a minimal prompt so
		// the backend (which requires a non-empty message) still has one.
		if ( ! trimmed && attachments.length === 0 ) {
			return;
		}
		const prompt = trimmed || __( 'Please review the attached files.' );
		const sentAttachments = attachments;
		setDraftValue( '' );
		clearAttachments();
		try {
			await onSend( prompt, toComposerSendAttachments( sentAttachments ) );
		} catch {
			// Restore the draft and attachments so the user can retry; the parent
			// surfaces the error message via `error`. Queued sends never throw from
			// onSend (the parent swallows the failure and clears the queue instead),
			// so this path only trips for direct sends from the idle state.
			setDraftValue( trimmed );
			restoreAttachments( sentAttachments );
		}
	}, [ value, attachments, clearAttachments, restoreAttachments, onSend, setDraftValue ] );

	const openFilePicker = useCallback( () => {
		fileInputRef.current?.click();
	}, [] );

	const onFileInputChange = useCallback(
		( event: React.ChangeEvent< HTMLInputElement > ) => {
			if ( event.target.files && event.target.files.length > 0 ) {
				void addFiles( event.target.files );
			}
			// Reset so picking the same file again re-triggers change.
			event.target.value = '';
		},
		[ addFiles ]
	);

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
			void getIpcApi()
				.setAiSessionModel( sessionId, picked )
				.catch( () => {
					void queryClient.invalidateQueries( {
						queryKey: [ ...SESSIONS_QUERY_KEY, sessionId ],
					} );
				} );
		},
		[ queryClient, sessionId ]
	);

	const handleModelChange = useCallback(
		( picked: AiModelId ) => {
			if ( picked === model ) {
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
		[ applySameFamilyModel, entries, model, onSwitchSession ]
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
			const newSession = await getIpcApi().createAiSession( ownerSiteId );
			// Persist the model on the fresh session before switching so the
			// composer there opens already on the picked family —
			// `setAiSessionModel` writes a `session.model_selected` event the
			// new view picks up via `resolveSessionModel`. If this fails we
			// still switch; the user can re-pick from the new view's dropdown.
			await getIpcApi()
				.setAiSessionModel( newSession.id, pendingFamilyChange )
				.catch( () => undefined );
			await queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ onSwitchSession, ownerSiteId, pendingFamilyChange, queryClient ] );

	const canSend = value.trim().length > 0 || attachments.length > 0;
	const placeholder = busy
		? __( 'Queue a follow-up instruction…' )
		: getSessionPlaceholder( sessionId );
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const modKey = isMacPlatform ? '⌘' : 'Ctrl';
	const hoveredAttachment = hoverPreview
		? attachments.find( ( attachment ) => attachment.id === hoverPreview.id )
		: undefined;
	const hoveredAttachmentSizeLabel = hoveredAttachment
		? formatComposerAttachmentSize( hoveredAttachment.size )
		: '';
	const fallbackAttachmentTypeLabel = __( 'FILE' );
	const fallbackAttachmentTypeDescription = __( 'File' );
	const hoveredAttachmentTypeLabel = hoveredAttachment
		? getComposerAttachmentTypeDescription( hoveredAttachment, fallbackAttachmentTypeDescription )
		: '';
	const hoveredAttachmentHasVisualPreview = hoveredAttachment
		? hasComposerAttachmentVisualPreview( hoveredAttachment )
		: false;

	return (
		<>
			<div className={ styles.root }>
				{ usageCapMessage ? (
					<div className={ styles.usageCapBanner } role="alert">
						{ usageCapMessage }
					</div>
				) : null }
				<div
					className={ cx( styles.shell, isDraggingOver && styles.shellDragging ) }
					onDragOver={ dragHandlers.onDragOver }
					onDragLeave={ dragHandlers.onDragLeave }
					onDrop={ dragHandlers.onDrop }
				>
					{ isDraggingOver ? (
						<div className={ styles.dropOverlay } aria-hidden="true">
							{ __( 'Drop files to attach' ) }
						</div>
					) : null }
					{ attachments.length > 0 ? (
						<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
							{ attachments.map( ( attachment ) => {
								const attachmentDetailsId = getAttachmentDetailsId( attachment.id );
								const attachmentSizeLabel = formatComposerAttachmentSize( attachment.size );
								const attachmentTypeDescription = getComposerAttachmentTypeDescription(
									attachment,
									fallbackAttachmentTypeDescription
								);
								const attachmentDetails = attachmentSizeLabel
									? sprintf(
											/* translators: 1: attachment file name, 2: attachment type, 3: attachment size. */
											__( 'Attachment: %1$s, %2$s, %3$s' ),
											attachment.name,
											attachmentTypeDescription,
											attachmentSizeLabel
									  )
									: sprintf(
											/* translators: 1: attachment file name, 2: attachment type. */
											__( 'Attachment: %1$s, %2$s' ),
											attachment.name,
											attachmentTypeDescription
									  );
								const showAttachmentPreview = ( element: HTMLElement ) => {
									setHoverPreview( {
										id: attachment.id,
										...getComposerAttachmentHoverPreviewPosition( element, attachment ),
									} );
								};
								const hideAttachmentPreview = () => {
									setHoverPreview( ( current ) =>
										current?.id === attachment.id ? null : current
									);
								};

								return (
									<li
										key={ attachment.id }
										className={ styles.attachmentItem }
										onPointerEnter={ ( event ) => {
											showAttachmentPreview( event.currentTarget );
										} }
										onPointerLeave={ ( event ) => {
											const activeElement = document.activeElement;
											if (
												activeElement instanceof Node &&
												event.currentTarget.contains( activeElement )
											) {
												return;
											}
											hideAttachmentPreview();
										} }
										onFocus={ ( event ) => {
											showAttachmentPreview( event.currentTarget );
										} }
										onBlur={ ( event ) => {
											const nextFocusedElement = event.relatedTarget;
											if (
												nextFocusedElement instanceof Node &&
												event.currentTarget.contains( nextFocusedElement )
											) {
												return;
											}
											hideAttachmentPreview();
										} }
									>
										<div className={ styles.attachmentTile } aria-hidden="true">
											{ renderAttachmentVisual( attachment, 'tile', fallbackAttachmentTypeLabel ) }
										</div>
										<span id={ attachmentDetailsId } className={ styles.attachmentAssistiveText }>
											{ attachmentDetails }
										</span>
										<button
											type="button"
											className={ styles.attachmentRemove }
											aria-label={ sprintf(
												/* translators: %s: attachment file name. */
												__( 'Remove attachment: %s' ),
												attachment.name
											) }
											aria-describedby={ attachmentDetailsId }
											onClick={ () => {
												removeAttachment( attachment.id );
											} }
										>
											<Icon icon={ closeSmall } size={ 16 } />
										</button>
									</li>
								);
							} ) }
						</ul>
					) : null }
					{ hoveredAttachment && hoverPreview ? (
						<div
							className={ styles.attachmentHoverPreview }
							role="tooltip"
							style={ {
								left: hoverPreview.left,
								bottom: hoverPreview.bottom,
								width: hoverPreview.width,
							} }
						>
							{ hoveredAttachmentHasVisualPreview ? (
								<div className={ styles.attachmentHoverArtwork }>
									{ renderAttachmentVisual(
										hoveredAttachment,
										'hover',
										fallbackAttachmentTypeLabel
									) }
								</div>
							) : null }
							<div className={ styles.attachmentHoverDetails }>
								<span className={ styles.attachmentHoverName }>{ hoveredAttachment.name }</span>
								<span className={ styles.attachmentHoverMeta }>
									<span className={ styles.attachmentHoverType }>
										{ hoveredAttachmentTypeLabel }
									</span>
									{ hoveredAttachmentSizeLabel ? (
										<>
											<span aria-hidden="true">·</span>
											<span>{ hoveredAttachmentSizeLabel }</span>
										</>
									) : null }
								</span>
							</div>
						</div>
					) : null }
					<div className={ styles.inputWrapper }>
						<textarea
							ref={ textareaRef }
							className={ styles.input }
							placeholder={ placeholder }
							value={ previewPrompt ?? value }
							data-preview={ previewPrompt ? 'true' : 'false' }
							{ ...slash.comboboxProps }
							onChange={ ( event ) => {
								setDraftValue( event.target.value );
							} }
							onPaste={ pasteHandlers.onPaste }
							onKeyDown={ ( event ) => {
								if ( slash.handleKeyDown( event ) ) {
									return;
								}
								if ( event.key === 'Escape' && busy ) {
									event.preventDefault();
									void onInterrupt();
									return;
								}
								if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
									event.preventDefault();
									void send();
								}
							} }
							rows={ 2 }
						/>
						{ slash.popup }
					</div>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<button
								type="button"
								className={ `${ styles.iconButton } ${ styles.glyphButton }` }
								aria-label={ __( 'Skills' ) }
								onClick={ slash.toggle }
							>
								/
							</button>
							<button
								type="button"
								className={ styles.iconButton }
								aria-label={ __( 'Attach files' ) }
								title={ __( 'Attach files' ) }
								onClick={ openFilePicker }
							>
								<Icon icon={ paperclipIcon } size={ 16 } />
							</button>
							<input
								ref={ fileInputRef }
								type="file"
								multiple
								className={ styles.fileInput }
								onChange={ onFileInputChange }
							/>
						</div>
						<div className={ styles.rightActions }>
							<Menu.Root modal={ false }>
								<Menu.Trigger
									render={
										<button
											type="button"
											className={ styles.pill }
											aria-label={ __( 'Select model' ) }
										>
											<span>{ getAiModelLabel( model ) }</span>
											<Icon icon={ chevronDownSmall } size={ 16 } />
										</button>
									}
								/>
								<Menu.Popup side="top" align="end">
									<Menu.RadioGroup
										value={ model }
										onValueChange={ ( value ) => handleModelChange( value as AiModelId ) }
									>
										{ visibleModels.map( ( { id, label } ) => (
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
							<button
								type="button"
								className={ styles.sendButton }
								onClick={ () => void send() }
								disabled={ ! canSend }
								aria-label={ sendAriaLabel }
							>
								<Icon icon={ arrowUp } size={ 18 } />
							</button>
						</div>
					</div>
				</div>
				<div className={ styles.meta }>
					<span className={ styles.metaHint }>
						{ createInterpolateElement(
							/* translators: <send/> and <newline/> are keyboard-shortcut chips, e.g. "⌘ ↩" and "shift ↩". */
							__( '<send/> to send · <newline/> for newline' ),
							{
								send: <span>{ modKey } ↩</span>,
								newline: <span>shift ↩</span>,
							}
						) }
					</span>
					{ error || attachmentError ? (
						<span className={ styles.error }>{ error ?? attachmentError }</span>
					) : null }
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
}
