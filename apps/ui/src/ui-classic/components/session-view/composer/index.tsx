import { formatClipsAsPrompt, formatClipsFallbackMessage } from '@studio/common/ai/clips';
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
import {
	getComposerClipAttachments,
	watchComposerFilePaste,
} from '@studio/common/ai/composer-attachments';
import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	arrowUp,
	chevronDownSmall,
	chevronRightSmall,
	closeSmall,
	page,
	plus,
} from '@wordpress/icons';
import { Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
	useState,
	type ChangeEvent,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTourAnchor } from '@/components/coachmarks/anchor-registry';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import {
	primeSessionQueryData,
	reconcilePrimedSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { useScrambledText } from '@/hooks/use-scrambled-text';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import {
	toComposerSendAttachments,
	useComposerAttachments,
	type ComposerAttachment,
	type ComposerClipInput,
	type ComposerSendAttachments,
} from './use-composer-attachments';
import type {
	AiModelId,
	LoadedAiSession,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
} from '@/data/core';

const COMPOSER_TEXTAREA_MIN_HEIGHT = 48;
const COMPOSER_TEXTAREA_MIN_MAX_HEIGHT = 180;
const COMPOSER_TEXTAREA_MAX_HEIGHT = 320;
const COMPOSER_TEXTAREA_MAX_VIEWPORT_RATIO = 0.4;
const COMPOSER_TEXTAREA_MANUAL_MAX_HEIGHT = 560;
const COMPOSER_TEXTAREA_MANUAL_MAX_VIEWPORT_RATIO = 0.7;
const COMPOSER_TEXTAREA_RESIZE_STEP = 16;

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

function formatSkillLabel( name: string ): string {
	return name
		.split( '-' )
		.map( ( word ) => word.charAt( 0 ).toUpperCase() + word.slice( 1 ) )
		.join( ' ' );
}

function toComposerDraftAttachments( {
	images = [],
	files = [],
}: {
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
} ): ComposerAttachment[] {
	return [
		...images.map(
			( image ): ComposerAttachment => ( {
				id: image.id,
				kind: 'image',
				name: image.name,
				mimeType: image.mimeType,
				size: image.size,
				dataBase64: image.dataBase64,
			} )
		),
		...files.map(
			( file ): ComposerAttachment => ( {
				id: file.id,
				kind: 'file',
				name: file.name,
				path: file.path,
				mimeType: file.mimeType,
				size: file.size ?? 0,
			} )
		),
	];
}

function createModelChangeEntry( modelId: AiModelId ): SessionEntry {
	return {
		type: 'model_change',
		id: Math.random().toString( 36 ).slice( 2, 10 ),
		parentId: null,
		timestamp: new Date().toISOString(),
		provider: '',
		modelId,
	} as unknown as SessionEntry;
}

/**
 * Invisible structural placeholder that mirrors Composer's outer DOM (shell +
 * textarea + toolbar) so the loading state can reserve the exact same vertical
 * space without rendering a visible composer. Heights track the real composer's
 * CSS automatically — no magic numbers that drift when the composer changes.
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
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	isInterrupting?: boolean;
	model: AiModelId;
	onSend: (
		prompt: string,
		attachments?: ComposerSendAttachments & { displayMessage?: string }
	) => Promise< void >;
	onInterrupt: () => Promise< void >;
	// Fires whenever the attachment set changes; the session view derives
	// preview clip markers from it.
	onAttachmentsChange?: ( attachments: ComposerAttachment[] ) => void;
	sessionId?: string;
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
	replaceDraft(
		text: string,
		attachments?: { images?: StudioChatImage[]; files?: StudioChatFileAttachment[] }
	): void;
	addFiles( files: FileList | File[] ): Promise< boolean >;
	addFileAttachments( files: StudioChatFileAttachment[] ): boolean;
	// Clips from the site preview (element/region/page/console grains).
	addClip( input: ComposerClipInput ): Promise< boolean >;
	updateClipComment( id: string, comment: string ): void;
	removeClip( id: string ): void;
	// Move keyboard focus to the textarea (e.g. after answering a permission
	// request, whose card takes focus while it's pending).
	focus(): void;
}

function shouldShellFocusTextarea( target: EventTarget ) {
	if ( ! ( target instanceof Element ) ) {
		return true;
	}
	return ! target.closest(
		'button, input, textarea, select, a, [role="button"], [role="menuitem"], [role="separator"]'
	);
}

function getComposerTextareaMaxHeight( isManual = false ) {
	const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
	const maxHeight = isManual ? COMPOSER_TEXTAREA_MANUAL_MAX_HEIGHT : COMPOSER_TEXTAREA_MAX_HEIGHT;
	const viewportRatio = isManual
		? COMPOSER_TEXTAREA_MANUAL_MAX_VIEWPORT_RATIO
		: COMPOSER_TEXTAREA_MAX_VIEWPORT_RATIO;

	if ( ! Number.isFinite( viewportHeight ) || viewportHeight <= 0 ) {
		return maxHeight;
	}

	return Math.min(
		maxHeight,
		Math.max( COMPOSER_TEXTAREA_MIN_MAX_HEIGHT, Math.floor( viewportHeight * viewportRatio ) )
	);
}

function clampComposerTextareaHeight( height: number, isManual = true ) {
	return Math.min(
		Math.max( height, COMPOSER_TEXTAREA_MIN_HEIGHT ),
		getComposerTextareaMaxHeight( isManual )
	);
}

function resizeComposerTextarea(
	node: HTMLTextAreaElement | null,
	manualHeight: number | null = null
) {
	if ( ! node ) {
		return null;
	}
	node.style.height = 'auto';
	const nextHeight =
		manualHeight === null
			? clampComposerTextareaHeight( node.scrollHeight, false )
			: clampComposerTextareaHeight( manualHeight, true );
	node.style.height = `${ nextHeight }px`;
	node.style.overflowY = node.scrollHeight > nextHeight ? 'auto' : 'hidden';
	return nextHeight;
}

export const Composer = forwardRef< ComposerHandle, ComposerProps >( function Composer(
	{
		busy,
		isInterrupting = false,
		model,
		onSend,
		onInterrupt,
		onAttachmentsChange,
		sessionId,
		entries,
		ownerSiteId,
		onSwitchSession,
		autoFocus = false,
	},
	ref
) {
	const composerAnchorRef = useTourAnchor( 'composer' );
	const [ value, setValue ] = useState( '' );
	const [ placeholderIndex, setPlaceholderIndex ] = useState( 0 );
	const [ hoverPreview, setHoverPreview ] = useState< ComposerAttachmentHoverPreviewState | null >(
		null
	);
	const [ manualTextareaHeight, setManualTextareaHeight ] = useState< number | null >( null );
	const [ textareaHeight, setTextareaHeight ] = useState( COMPOSER_TEXTAREA_MIN_HEIGHT );
	const [ isResizingComposer, setIsResizingComposer ] = useState( false );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const manualTextareaHeightRef = useRef< number | null >( null );
	const resizeDragRef = useRef< { startY: number; startHeight: number } | null >( null );
	const connector = useConnector();
	const queryClient = useQueryClient();

	// File/image attachments (attach button + drag-and-drop). Images ride as
	// base64 content blocks; other files are referenced by disk path.
	const {
		attachments,
		isDraggingOver,
		addFiles,
		addFileAttachments,
		addClip,
		updateClipComment,
		removeAttachment,
		clear: clearAttachments,
		restore: restoreAttachments,
		dragHandlers,
		pasteHandlers,
	} = useComposerAttachments( getAiModelFamily( model ) );
	const hasAttachments = attachments.length > 0;

	// Mirror the attachment set to the parent (preview clip markers).
	useEffect( () => {
		onAttachmentsChange?.( attachments );
	}, [ attachments, onAttachmentsChange ] );

	// Cross-family swap state. We hold the picked model here while the
	// confirmation dialog is open; nothing is persisted until the user
	// confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	const setComposerManualTextareaHeight = useCallback( ( height: number | null ) => {
		const nextHeight = height === null ? null : clampComposerTextareaHeight( height, true );
		manualTextareaHeightRef.current = nextHeight;
		setManualTextareaHeight( nextHeight );
		return nextHeight;
	}, [] );

	useEffect( () => {
		if ( autoFocus ) {
			textareaRef.current?.focus();
		}
	}, [ autoFocus, sessionId ] );

	useEffect( () => {
		return watchComposerFilePaste( ( files ) => {
			void addFiles( files );
			textareaRef.current?.focus();
		} );
	}, [ addFiles ] );

	useLayoutEffect( () => {
		const nextHeight = resizeComposerTextarea( textareaRef.current, manualTextareaHeight );
		if ( nextHeight !== null ) {
			setTextareaHeight( ( current ) => ( current === nextHeight ? current : nextHeight ) );
		}
	}, [ manualTextareaHeight, value, hasAttachments ] );

	useEffect( () => {
		const handleViewportResize = () => {
			const nextManualHeight = setComposerManualTextareaHeight( manualTextareaHeightRef.current );
			const nextHeight = resizeComposerTextarea( textareaRef.current, nextManualHeight );
			if ( nextHeight !== null ) {
				setTextareaHeight( ( current ) => ( current === nextHeight ? current : nextHeight ) );
			}
		};
		window.addEventListener( 'resize', handleViewportResize );
		window.visualViewport?.addEventListener( 'resize', handleViewportResize );
		return () => {
			window.removeEventListener( 'resize', handleViewportResize );
			window.visualViewport?.removeEventListener( 'resize', handleViewportResize );
		};
	}, [ setComposerManualTextareaHeight ] );

	useEffect( () => {
		if ( value.length > 0 ) {
			return;
		}
		const interval = window.setInterval( () => {
			setPlaceholderIndex( ( current ) => current + 1 );
		}, 5000 );
		return () => window.clearInterval( interval );
	}, [ value ] );

	useEffect( () => {
		setPlaceholderIndex( 0 );
	}, [ busy ] );

	useImperativeHandle(
		ref,
		() => ( {
			focus() {
				textareaRef.current?.focus();
			},
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
			replaceDraft( text, draftAttachments ) {
				setValue( text );
				restoreAttachments( toComposerDraftAttachments( draftAttachments ?? {} ) );
				queueMicrotask( () => {
					const node = textareaRef.current;
					if ( ! node ) return;
					node.focus();
					const len = node.value.length;
					node.setSelectionRange( len, len );
				} );
			},
			async addFiles( files ) {
				const didAdd = await addFiles( files );
				if ( didAdd ) {
					requestAnimationFrame( () => {
						textareaRef.current?.focus();
					} );
				}
				return didAdd;
			},
			addFileAttachments( files ) {
				const didAdd = addFileAttachments( files );
				if ( didAdd ) {
					requestAnimationFrame( () => {
						textareaRef.current?.focus();
					} );
				}
				return didAdd;
			},
			async addClip( input ) {
				return addClip( input );
			},
			updateClipComment( id, comment ) {
				updateClipComment( id, comment );
			},
			removeClip( id ) {
				removeAttachment( id );
			},
		} ),
		[
			addClip,
			addFileAttachments,
			addFiles,
			removeAttachment,
			restoreAttachments,
			updateClipComment,
		]
	);

	const send = useCallback( async () => {
		const trimmed = value.trim();
		// Allow sending attachments on their own; fall back to a minimal prompt so
		// the backend (which requires a non-empty message) still has one.
		if ( ! trimmed && ! hasAttachments ) {
			return;
		}
		const sentAttachments = attachments;
		const clips = getComposerClipAttachments( sentAttachments );
		const prompt =
			trimmed ||
			( clips.length > 0
				? formatClipsFallbackMessage( clips.length )
				: __( 'Please review the attached files.' ) );
		// Clips serialize into a prompt block the user doesn't see typed out;
		// the visible message stays their own words (the chips are visible as
		// the message's attachments).
		const clipsPrompt = formatClipsAsPrompt( clips );
		const fullPrompt = clipsPrompt ? `${ prompt }\n${ clipsPrompt }` : prompt;
		setValue( '' );
		clearAttachments();
		try {
			await onSend( fullPrompt, {
				...toComposerSendAttachments( sentAttachments ),
				...( clipsPrompt ? { displayMessage: prompt } : {} ),
			} );
		} catch {
			// Restore the draft and attachments so the user can retry; the parent
			// surfaces the error message via `error`. Queued sends never throw from
			// onSend (the parent swallows the failure and clears the queue instead),
			// so this path only trips for direct sends from the idle state.
			setValue( trimmed );
			restoreAttachments( sentAttachments );
		}
	}, [ value, attachments, hasAttachments, clearAttachments, restoreAttachments, onSend ] );

	const openFilePicker = useCallback( () => {
		fileInputRef.current?.click();
	}, [] );

	const focusTextareaFromShell = useCallback( ( event: MouseEvent< HTMLDivElement > ) => {
		if ( ! shouldShellFocusTextarea( event.target ) ) {
			return;
		}
		event.preventDefault();
		textareaRef.current?.focus();
	}, [] );

	const startComposerResize = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			if ( event.pointerType === 'mouse' && event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			const startHeight = textareaRef.current?.getBoundingClientRect().height ?? textareaHeight;
			resizeDragRef.current = {
				startY: event.clientY,
				startHeight,
			};
			setIsResizingComposer( true );
			setComposerManualTextareaHeight( startHeight );
			if ( typeof event.currentTarget.setPointerCapture === 'function' ) {
				event.currentTarget.setPointerCapture( event.pointerId );
			}
		},
		[ setComposerManualTextareaHeight, textareaHeight ]
	);

	const updateComposerResize = useCallback(
		( event: PointerEvent< HTMLDivElement > ) => {
			const drag = resizeDragRef.current;
			if ( ! drag ) {
				return;
			}
			event.preventDefault();
			setComposerManualTextareaHeight( drag.startHeight + drag.startY - event.clientY );
		},
		[ setComposerManualTextareaHeight ]
	);

	const finishComposerResize = useCallback( ( event: PointerEvent< HTMLDivElement > ) => {
		if ( ! resizeDragRef.current ) {
			return;
		}
		resizeDragRef.current = null;
		setIsResizingComposer( false );
		if (
			typeof event.currentTarget.releasePointerCapture === 'function' &&
			typeof event.currentTarget.hasPointerCapture === 'function' &&
			event.currentTarget.hasPointerCapture( event.pointerId )
		) {
			event.currentTarget.releasePointerCapture( event.pointerId );
		}
	}, [] );

	const handleComposerResizeKeyDown = useCallback(
		( event: KeyboardEvent< HTMLDivElement > ) => {
			const currentHeight = textareaRef.current?.getBoundingClientRect().height ?? textareaHeight;
			let nextHeight: number | null = null;

			if ( event.key === 'ArrowUp' ) {
				nextHeight = currentHeight + COMPOSER_TEXTAREA_RESIZE_STEP;
			} else if ( event.key === 'ArrowDown' ) {
				nextHeight = currentHeight - COMPOSER_TEXTAREA_RESIZE_STEP;
			} else if ( event.key === 'Home' ) {
				nextHeight = COMPOSER_TEXTAREA_MIN_HEIGHT;
			} else if ( event.key === 'End' ) {
				nextHeight = getComposerTextareaMaxHeight( true );
			}

			if ( nextHeight === null ) {
				return;
			}

			event.preventDefault();
			setComposerManualTextareaHeight( nextHeight );
		},
		[ setComposerManualTextareaHeight, textareaHeight ]
	);

	const onFileInputChange = useCallback(
		( event: ChangeEvent< HTMLInputElement > ) => {
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
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, sessionId ],
				( prev ) =>
					prev
						? {
								...prev,
								entries: [ ...( prev.entries ?? [] ), createModelChangeEntry( picked ) ],
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
		const pickedModel = pendingFamilyChange;
		setFamilySwitchInFlight( true );
		try {
			const newSession = await connector.createSession( ownerSiteId );
			primeSessionQueryData( queryClient, newSession );
			// Persist the model on the fresh session before navigating so the
			// composer there opens already on the picked family —
			// `setSessionModel` writes a `session.model_selected` event the
			// new view picks up via `resolveSessionModel`. If this fails we
			// still navigate; the user can re-pick from the new view's
			// dropdown.
			await connector.setSessionModel( newSession.id, pickedModel ).catch( () => undefined );
			queryClient.setQueryData< LoadedAiSession >(
				[ ...SESSIONS_QUERY_KEY, newSession.id ],
				( current ) =>
					current
						? {
								...current,
								entries: [ ...( current.entries ?? [] ), createModelChangeEntry( pickedModel ) ],
						  }
						: {
								summary: newSession,
								entries: [ createModelChangeEntry( pickedModel ) ],
						  }
			);
			await reconcilePrimedSessionQueryData( queryClient, newSession.id );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, onSwitchSession, ownerSiteId, pendingFamilyChange, queryClient ] );

	const canSend = value.trim().length > 0 || hasAttachments;
	const placeholderOptions = busy
		? [
				__( 'Queue the next message while I work…' ),
				__( 'Type a follow-up and I’ll send it next…' ),
				__( 'Add the next step to the queue…' ),
		  ]
		: [
				__( 'What should we make better?' ),
				__( 'What’s the next move?' ),
				__( 'Tell me what to change next…' ),
				__( 'Drop the next idea here…' ),
				__( 'What are we tuning now?' ),
		  ];
	const placeholder = placeholderOptions[ placeholderIndex % placeholderOptions.length ];
	const showAnimatedPlaceholder = value.length === 0;
	const animatedPlaceholder = useScrambledText( placeholder, showAnimatedPlaceholder );
	const composerResizeMaxHeight = getComposerTextareaMaxHeight( true );
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const sendShortcutLabel = __( 'Return to send' );
	const stopTooltipLabel = isInterrupting
		? __( 'Stopping… click again to force stop' )
		: __( 'Stop' );
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
			<div className={ styles.root } ref={ composerAnchorRef }>
				<div
					className={ clsx(
						styles.shell,
						isDraggingOver && styles.shellDragging,
						isResizingComposer && styles.shellResizing
					) }
					onMouseDown={ focusTextareaFromShell }
					onDragOver={ dragHandlers.onDragOver }
					onDragLeave={ dragHandlers.onDragLeave }
					onDrop={ dragHandlers.onDrop }
				>
					<div
						className={ styles.resizeHandle }
						role="separator"
						aria-orientation="horizontal"
						aria-label={ __( 'Resize composer' ) }
						aria-valuemin={ COMPOSER_TEXTAREA_MIN_HEIGHT }
						aria-valuemax={ composerResizeMaxHeight }
						aria-valuenow={ Math.round( textareaHeight ) }
						tabIndex={ 0 }
						onPointerDown={ startComposerResize }
						onPointerMove={ updateComposerResize }
						onPointerUp={ finishComposerResize }
						onPointerCancel={ finishComposerResize }
						onLostPointerCapture={ finishComposerResize }
						onKeyDown={ handleComposerResizeKeyDown }
					/>
					{ isDraggingOver ? (
						<div className={ styles.dropOverlay } aria-hidden="true">
							{ __( 'Drop files to attach' ) }
						</div>
					) : null }
					{ hasAttachments ? (
						<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
							{ attachments.map( ( attachment ) => {
								// Clip chips wear the same number as their on-page marker
								// (position among clip siblings, matching the marker sync).
								const clipNumber =
									attachment.kind === 'clip'
										? getComposerClipAttachments( attachments ).findIndex(
												( clip ) => clip.id === attachment.id
										  ) + 1
										: 0;
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
											{ clipNumber > 0 ? (
												<span className={ styles.attachmentClipBadge }>{ clipNumber }</span>
											) : null }
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
					{ hoveredAttachment && hoverPreview
						? createPortal(
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
								</div>,
								document.body
						  )
						: null }
					<div
						className={ clsx(
							styles.inputArea,
							hasAttachments && styles.inputAreaWithAttachments
						) }
					>
						{ showAnimatedPlaceholder ? (
							<div className={ styles.placeholderText } aria-hidden="true">
								{ animatedPlaceholder }
							</div>
						) : null }
						<textarea
							ref={ textareaRef }
							className={ styles.input }
							placeholder={ placeholder }
							value={ value }
							onChange={ ( event ) => setValue( event.target.value ) }
							onPaste={ pasteHandlers.onPaste }
							onKeyDown={ ( event ) => {
								if ( event.key === 'Escape' && busy ) {
									event.preventDefault();
									void onInterrupt();
									return;
								}
								if ( event.key === 'Enter' && ( event.metaKey || event.ctrlKey ) ) {
									event.preventDefault();
									const node = event.currentTarget;
									const start = node.selectionStart;
									const end = node.selectionEnd;
									const nextValue = `${ node.value.slice( 0, start ) }\n${ node.value.slice(
										end
									) }`;
									setValue( nextValue );
									queueMicrotask( () => {
										textareaRef.current?.setSelectionRange( start + 1, start + 1 );
									} );
									return;
								}
								if ( event.key === 'Enter' && ! event.shiftKey ) {
									event.preventDefault();
									void send();
								}
							} }
							rows={ 2 }
						/>
					</div>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<Menu.Root modal={ false }>
								<Tooltip.Root>
									<Menu.Trigger
										render={
											<Tooltip.Trigger
												render={
													<button
														type="button"
														className={ styles.iconButton }
														aria-label={ __( 'Add skill or attachment' ) }
													/>
												}
											>
												<Icon icon={ plus } size={ 16 } />
											</Tooltip.Trigger>
										}
									/>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ __( 'Add skill or attachment' ) }
									</Tooltip.Popup>
								</Tooltip.Root>
								<Menu.Popup side="top" align="start" className={ styles.commandsMenuPopup }>
									<Menu.Item onClick={ openFilePicker }>{ __( 'Upload attachment' ) }</Menu.Item>
									<Menu.SubmenuRoot>
										<Menu.SubmenuTrigger className={ styles.skillsSubmenuTrigger }>
											<span>{ __( 'Skills' ) }</span>
											<Icon
												icon={ chevronRightSmall }
												size={ 16 }
												className={ styles.submenuChevron }
												aria-hidden="true"
											/>
										</Menu.SubmenuTrigger>
										<Menu.Popup side="right" align="start" className={ styles.skillsMenuPopup }>
											{ AI_SKILL_COMMANDS.map( ( command ) => (
												<Menu.Item
													key={ command.name }
													className={ styles.skillMenuItem }
													onClick={ () => {
														void onSend( `/${ command.name }` );
													} }
												>
													<span className={ styles.skillMenuItemBody }>
														<span className={ styles.skillMenuItemLabel }>
															{ formatSkillLabel( command.name ) }
														</span>
														<span className={ styles.skillMenuItemDescription }>
															{ command.description }
														</span>
													</span>
												</Menu.Item>
											) ) }
										</Menu.Popup>
									</Menu.SubmenuRoot>
								</Menu.Popup>
							</Menu.Root>
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
								<Tooltip.Root>
									<Menu.Trigger
										render={
											<Tooltip.Trigger
												render={
													<button
														type="button"
														className={ styles.pill }
														aria-label={ __( 'Select model' ) }
													/>
												}
											>
												<span>{ getAiModelLabel( model ) }</span>
												<Icon icon={ chevronDownSmall } size={ 16 } />
											</Tooltip.Trigger>
										}
									/>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ __( 'Select model' ) }
									</Tooltip.Popup>
								</Tooltip.Root>
								<Menu.Popup side="top" align="end">
									<Menu.RadioGroup
										value={ model }
										onValueChange={ ( value ) => handleModelChange( value as AiModelId ) }
									>
										{ AI_MODELS.map( ( { id, label } ) => (
											<Menu.RadioItem key={ id } value={ id }>
												{ label }
											</Menu.RadioItem>
										) ) }
									</Menu.RadioGroup>
								</Menu.Popup>
							</Menu.Root>
							{ busy ? (
								<Tooltip.Root>
									<Tooltip.Trigger
										render={
											<button
												type="button"
												className={ styles.stopButton }
												onClick={ () => void onInterrupt() }
												aria-label={ isInterrupting ? __( 'Stopping' ) : __( 'Stop' ) }
												aria-busy={ isInterrupting }
											/>
										}
									>
										<span className={ styles.stopGlyph } aria-hidden="true" />
									</Tooltip.Trigger>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ stopTooltipLabel }
									</Tooltip.Popup>
								</Tooltip.Root>
							) : null }
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
									{ sendShortcutLabel }
								</Tooltip.Popup>
							</Tooltip.Root>
						</div>
					</div>
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
