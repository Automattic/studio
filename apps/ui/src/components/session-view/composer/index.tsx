import {
	formatComposerAttachmentSize,
	getComposerAttachmentHoverPreviewPosition,
	getComposerAttachmentImageSrc,
	getComposerAttachmentTextPreview,
	getComposerAttachmentTypeDescription,
	hasComposerAttachmentVisualPreview,
	watchComposerAttachmentTextScroll,
	type ComposerAttachmentHoverPreviewState,
} from '@studio/common/ai/composer-attachment-preview';
import { watchComposerFilePaste } from '@studio/common/ai/composer-attachments';
import {
	aiModelRequiresPaidCredits,
	getAiModelFamily,
	getAiModelLabel,
} from '@studio/common/ai/models';
import {
	AI_PROVIDER_IDS,
	AI_PROVIDER_LABELS,
	getAiProviderDefaultModel,
	getAiProviderModels,
	getEffectiveSessionProvider,
	providerServesModel,
	type AiProviderId,
} from '@studio/common/ai/providers';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { getAiSkillCommands, resolveSkillFromPrompt } from '@studio/common/ai/slash-commands';
import { isAutomatticianEmail } from '@studio/common/lib/automattician';
import { hasPaidAiCredits } from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import {
	arrowUp,
	chevronDownSmall,
	chevronRightSmall,
	closeSmall,
	globe,
	page,
	play,
	plus,
} from '@wordpress/icons';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type MouseEvent,
	type ReactElement,
	type SVGProps,
} from 'react';
import { createPortal } from 'react-dom';
import { AiCreditsPurchaseDialog } from '@/components/ai-credits-purchase-dialog';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	createModelChangeEntry,
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useAddAiCreditsUrl } from '@/hooks/use-add-ai-credits-url';
import { useAiCreditsMeter } from '@/hooks/use-ai-credits-meter';
import { useIsOutOfAiCredits } from '@/hooks/use-is-out-of-ai-credits';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { isImeComposing } from '@/lib/is-ime-composing';
import { completeComposerDraftSend, getComposerDraft, saveComposerDraft } from './draft-store';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import {
	toComposerSendAttachments,
	useComposerAttachments,
	useFileDrop,
	type ComposerAttachment,
	type ComposerSendAttachments,
} from './use-composer-attachments';
import { useSlashCommands } from './use-slash-commands';
import type {
	AiModelId,
	LoadedAiSession,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
} from '@/data/core';

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

function renderAttachmentHoverVisual( attachment: ComposerAttachment ) {
	const imageSrc = getComposerAttachmentImageSrc( attachment );
	if ( imageSrc ) {
		return <img className={ styles.attachmentHoverImage } src={ imageSrc } alt="" />;
	}
	const textPreview = getComposerAttachmentTextPreview( attachment );
	return textPreview ? <AttachmentHoverTextPreview text={ textPreview } /> : null;
}

function formatSkillLabel( name: string ): string {
	return name
		.split( '-' )
		.map( ( word ) => word.charAt( 0 ).toUpperCase() + word.slice( 1 ) )
		.join( ' ' );
}

function getModelDescription( id: AiModelId ): string {
	switch ( id ) {
		case 'fast':
			return __( 'Quick fixes and questions' );
		case 'balanced':
		case 'claude-sonnet-5':
			return __( 'Build features, style pages, and fix bugs' );
		case 'strong':
		case 'claude-opus-5':
			return __( 'Plan complex builds and solve harder problems' );
		default:
			return '';
	}
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

// Optimistic mirror of the `studio.session_context` entry the backend appends
// for a provider switch, so the picker updates before the write lands.
function createSessionContextEntry( provider: AiProviderId, model: AiModelId ): SessionEntry {
	return {
		type: 'custom',
		id: Math.random().toString( 36 ).slice( 2, 10 ),
		parentId: null,
		timestamp: new Date().toISOString(),
		customType: 'studio.session_context',
		data: { provider, model },
	} as unknown as SessionEntry;
}

// Brand names, so no translation and no per-render rebuild.
const AI_PROVIDER_OPTIONS = AI_PROVIDER_IDS.map( ( id ) => ( {
	id,
	label: AI_PROVIDER_LABELS[ id ],
} ) );

// A blocked send shakes the notice, then holds it in the error color briefly.
const SUBMIT_SHAKE_MS = 240;
const SUBMIT_FEEDBACK_MS = 900;

// A mode the composer is in; hovering offers to remove it.
function ModeChip( {
	icon,
	label,
	onRemove,
}: {
	icon: ReactElement< SVGProps< SVGSVGElement > >;
	label: string;
	onRemove: () => void;
} ) {
	const removeLabel = sprintf(
		/* translators: %s: name of a composer mode, e.g. "Auto-start". */
		__( 'Remove %s' ),
		label
	);
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<button
						type="button"
						className={ styles.modeChip }
						aria-label={ removeLabel }
						onClick={ onRemove }
					/>
				}
			>
				<Icon icon={ icon } size={ 16 } className={ styles.modeChipIcon } />
				<Icon icon={ closeSmall } size={ 16 } className={ styles.modeChipRemove } />
				<span>{ label }</span>
			</Tooltip.Trigger>
			<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
				{ removeLabel }
			</Tooltip.Popup>
		</Tooltip.Root>
	);
}

/**
 * Invisible structural placeholder that mirrors Composer's outer DOM, so the
 * loading state reserves the same vertical space without a visible composer.
 */
export function ComposerSkeleton() {
	return (
		<div className={ styles.root } style={ { visibility: 'hidden' } } aria-hidden="true">
			<div className={ styles.shell }>
				<textarea className={ styles.input } rows={ 1 } disabled tabIndex={ -1 } />
				<div className={ styles.toolbar }>
					<span className={ styles.controlButton } />
				</div>
			</div>
		</div>
	);
}

interface ComposerProps {
	busy: boolean;
	// The agent is blocked on `ask_user`. Sending answers the question it is
	// waiting on, so this is a send, not a queue.
	awaitingAnswer?: boolean;
	isInterrupting?: boolean;
	model: AiModelId;
	onSend: ( prompt: string, attachments?: ComposerSendAttachments ) => Promise< void >;
	onAnswer?: ( answer: string ) => void;
	onInterrupt: () => Promise< void >;
	sessionId?: string;
	entries?: SessionEntry[];
	// Local owner site id, when the session is anchored to one. Required to
	// spin up a fresh session via `connector.createSession` on a confirmed
	// family swap; if absent we fall back to the in-place model change so the
	// dropdown still works for unowned sessions.
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	autoFocus?: boolean;
	// 'field': embedded in a form that submits the draft itself via
	// `getSubmission()` — no Send/Stop control, Enter inserts a newline.
	variant?: 'chat' | 'field';
	placeholder?: string;
	// The placeholder describes work in progress (e.g. the site starting).
	placeholderBusy?: boolean;
	// Offers the auto-start preference, for a chat on a local site.
	canAutoStart?: boolean;
	// The site the chat works on, and the connected live site it can switch to.
	environment?: 'local' | 'live';
	liveUrl?: string;
	onEnvironmentChange?: ( environment: 'local' | 'live' ) => void;
	// Where files can be dropped; the composer itself when absent.
	dropTarget?: HTMLElement | null;
	onModelChange?: ( model: AiModelId ) => void;
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
		options?: {
			images?: StudioChatImage[];
			files?: StudioChatFileAttachment[];
			suggestionBaseline?: string;
		}
	): void;
	// What replaceDraft would discard — lets callers decide whether the
	// replacement warrants a confirmation.
	getDraft(): { text: string; hasAttachments: boolean; suggestionBaseline: string | null };
	getSubmission(): { prompt: string; attachments: ComposerSendAttachments } | null;
	focus(): void;
}

function focusAtEnd( node: HTMLTextAreaElement | null ) {
	if ( ! node ) {
		return;
	}
	node.focus();
	const length = node.value.length;
	node.setSelectionRange( length, length );
}

function shouldShellFocusTextarea( target: EventTarget ) {
	if ( ! ( target instanceof Element ) ) {
		return true;
	}
	return ! target.closest(
		'button, input, textarea, select, a, [role="button"], [role="menuitem"]'
	);
}

const ComposerContent = forwardRef< ComposerHandle, ComposerProps >( function ComposerContent(
	{
		busy,
		awaitingAnswer = false,
		isInterrupting = false,
		model,
		onSend,
		onAnswer,
		onInterrupt,
		sessionId,
		entries,
		ownerSiteId,
		onSwitchSession,
		autoFocus = false,
		variant = 'chat',
		placeholder: placeholderOverride,
		placeholderBusy = false,
		canAutoStart = false,
		environment = 'local',
		liveUrl,
		onEnvironmentChange,
		dropTarget,
		onModelChange,
	},
	ref
) {
	const isField = variant === 'field';
	const [ initialDraft ] = useState( () => getComposerDraft( sessionId ) );
	const [ value, setValue ] = useState( initialDraft.text );
	const [ suggestionBaseline, setSuggestionBaseline ] = useState( initialDraft.suggestionBaseline );
	const [ sending, setSending ] = useState( false );
	const [ submitFeedback, setSubmitFeedback ] = useState< 'shake' | 'error' | null >( null );
	const [ hoverPreview, setHoverPreview ] = useState< ComposerAttachmentHoverPreviewState | null >(
		null
	);
	const [ shellNode, setShellNode ] = useState< HTMLDivElement | null >( null );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const draftEffectInitializedRef = useRef( false );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const openSettings = useOpenSettings();

	const { data: aiSettings } = useAiSettings();
	const sessionProvider = useMemo(
		() => getEffectiveSessionProvider( entries ?? [], aiSettings ),
		[ entries, aiSettings ]
	);
	const canPickProvider = Boolean( aiSettings?.hasAnthropicApiKey && sessionId );

	// Only offer models the conversation's provider can serve. The paid tiers
	// are listed but disabled for accounts without purchased credits;
	// Automatticians are exempt.
	const offeredModels = getAiProviderModels( sessionProvider );
	const { data: quota } = useStudioAssistantQuota();
	const { data: authUser } = useAuthUser();
	const canUsePaidTiers = hasPaidAiCredits( quota ) || isAutomatticianEmail( authUser?.email );
	const isModelLocked = useCallback(
		( id: AiModelId ) => aiModelRequiresPaidCredits( id ) && ! canUsePaidTiers,
		[ canUsePaidTiers ]
	);
	const creditsMeter = useAiCreditsMeter();
	const isOutOfCredits = useIsOutOfAiCredits() && ! isField;

	// The chooser when priced options exist, else straight to checkout for the
	// single fixed top-up.
	const addAiCreditsUrl = useAddAiCreditsUrl();
	const { data: topUpPricing } = useStudioAssistantTopUpPricing();
	const [ creditsPurchaseOpen, setCreditsPurchaseOpen ] = useState( false );
	const openAddCredits = () => {
		if ( ( topUpPricing?.options.length ?? 0 ) > 0 ) {
			setCreditsPurchaseOpen( true );
			return;
		}
		void connector.openExternalUrl( addAiCreditsUrl );
	};

	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const autoStartOn = canAutoStart && preferences?.autoStartSiteOnChat === true;
	const setAutoStart = ( autoStartSiteOnChat: boolean ) =>
		savePreferences.mutate( { autoStartSiteOnChat } );

	const slash = useSlashCommands( {
		value,
		setValue,
		textareaRef,
	} );

	// File/image attachments (attach button, drop and paste). Images ride as
	// base64 content blocks; other files are referenced by disk path.
	const {
		attachments,
		addFiles,
		removeAttachment,
		removeAttachments,
		restore: restoreAttachments,
		pasteHandlers,
	} = useComposerAttachments( initialDraft.attachments, awaitingAnswer );
	const hasAttachments = attachments.length > 0;
	const dropFiles = useCallback(
		( files: FileList ) => {
			void addFiles( files );
			textareaRef.current?.focus();
		},
		[ addFiles ]
	);
	const fileDropTarget = dropTarget ?? shellNode;
	const isDraggingFiles = useFileDrop( fileDropTarget, dropFiles );

	useEffect( () => {
		if ( draftEffectInitializedRef.current ) {
			saveComposerDraft( sessionId, { text: value, attachments, suggestionBaseline } );
		} else {
			draftEffectInitializedRef.current = true;
		}
	}, [ attachments, sessionId, suggestionBaseline, value ] );

	useEffect( () => {
		if ( submitFeedback === null ) {
			return;
		}
		const timer = window.setTimeout(
			() => setSubmitFeedback( submitFeedback === 'shake' ? 'error' : null ),
			submitFeedback === 'shake' ? SUBMIT_SHAKE_MS : SUBMIT_FEEDBACK_MS - SUBMIT_SHAKE_MS
		);
		return () => window.clearTimeout( timer );
	}, [ submitFeedback ] );

	// Cross-family swap state. We hold the picked model (and provider, when
	// the swap came from the provider picker) here while the confirmation
	// dialog is open; nothing is persisted until the user confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< {
		model: AiModelId;
		provider?: AiProviderId;
	} | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

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
				queueMicrotask( () => focusAtEnd( textareaRef.current ) );
			},
			replaceDraft( text, options ) {
				setValue( text );
				setSuggestionBaseline( options?.suggestionBaseline ?? null );
				restoreAttachments( toComposerDraftAttachments( options ?? {} ) );
				queueMicrotask( () => focusAtEnd( textareaRef.current ) );
			},
			getDraft() {
				return { text: value, hasAttachments: attachments.length > 0, suggestionBaseline };
			},
			getSubmission() {
				const prompt = value.trim();
				if ( ! prompt && attachments.length === 0 ) return null;
				return { prompt, attachments: toComposerSendAttachments( attachments ) };
			},
			focus() {
				focusAtEnd( textareaRef.current );
			},
		} ),
		[ restoreAttachments, value, attachments, suggestionBaseline ]
	);

	const answerQuestion =
		onAnswer && ! hasAttachments && ! resolveSkillFromPrompt( value ) ? onAnswer : undefined;
	const hasContent = value.trim().length > 0 || hasAttachments;

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( sending || ( ! trimmed && attachments.length === 0 ) ) {
			return;
		}
		if ( isOutOfCredits ) {
			setSubmitFeedback( 'shake' );
			return;
		}
		if ( answerQuestion ) {
			setValue( '' );
			setSuggestionBaseline( null );
			answerQuestion( trimmed );
			return;
		}
		// The draft stays editable until the send is accepted; only then is what
		// was sent removed, keeping anything typed or attached in the meantime.
		const sentIds = new Set( attachments.map( ( item ) => item.id ) );
		setSending( true );
		try {
			await onSend(
				trimmed || __( 'Please review the attached files.' ),
				toComposerSendAttachments( attachments )
			);
		} catch {
			// The parent reports the failure in a toast; the draft is untouched.
			return;
		} finally {
			setSending( false );
		}
		completeComposerDraftSend( sessionId, trimmed, sentIds );
		if ( ( textareaRef.current?.value ?? '' ).trim() === trimmed ) {
			setValue( '' );
			setSuggestionBaseline( null );
		}
		removeAttachments( sentIds );
	}, [
		value,
		sending,
		attachments,
		isOutOfCredits,
		answerQuestion,
		onSend,
		sessionId,
		removeAttachments,
	] );

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

	// Show the entry right away, then write it; refetch on write fail so the
	// transcript falls back to what actually landed.
	const appendEntryOptimistically = useCallback(
		( entry: SessionEntry, write: ( id: string ) => Promise< void > ) => {
			if ( ! sessionId ) {
				return;
			}
			const queryKey = [ ...SESSIONS_QUERY_KEY, sessionId ];
			queryClient.setQueryData< LoadedAiSession >( queryKey, ( prev ) =>
				prev ? { ...prev, entries: [ ...( prev.entries ?? [] ), entry ] } : prev
			);
			void write( sessionId ).catch( () => {
				void queryClient.invalidateQueries( { queryKey } );
			} );
		},
		[ queryClient, sessionId ]
	);

	// Same-family swap: optimistic `model_change` entry.
	const applySameFamilyModel = useCallback(
		( picked: AiModelId ) => {
			appendEntryOptimistically( createModelChangeEntry( picked ), ( id ) =>
				connector.setSessionModel( id, picked )
			);
		},
		[ appendEntryOptimistically, connector ]
	);

	const sessionHasTurns = useMemo(
		() =>
			( entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			),
		[ entries ]
	);

	// Pin this conversation to a provider, carrying a model it serves in the
	// same entry. Providers don't share a model family, so the switch goes
	// through the same fresh-session confirmation as a cross-family model
	// switch.
	const handleProviderChange = useCallback(
		( picked: AiProviderId ) => {
			if ( picked === sessionProvider ) {
				return;
			}
			const nextModel = providerServesModel( picked, model )
				? model
				: getAiProviderDefaultModel( picked, { hasPaidAiCredits: hasPaidAiCredits( quota ) } );
			if (
				getAiModelFamily( model ) !== getAiModelFamily( nextModel ) &&
				onSwitchSession &&
				sessionHasTurns
			) {
				setPendingFamilyChange( { model: nextModel, provider: picked } );
				return;
			}
			appendEntryOptimistically( createSessionContextEntry( picked, nextModel ), ( id ) =>
				connector.setSessionProvider( id, picked, nextModel )
			);
		},
		[
			appendEntryOptimistically,
			connector,
			model,
			onSwitchSession,
			quota,
			sessionHasTurns,
			sessionProvider,
		]
	);

	const handleModelChange = useCallback(
		( picked: AiModelId ) => {
			if ( picked === model || isModelLocked( picked ) ) {
				return;
			}
			if ( onModelChange ) {
				onModelChange( picked );
				return;
			}
			// Cross-family switch: defer until the user confirms in the dialog
			// — the runtimes don't share a transcript, so continuing the same
			// JSONL across families would make the on-screen history disagree
			// with the agent's actual memory. We skip the prompt when the
			// session has no user turns yet, or when the parent cannot switch
			// to a freshly created session.
			if (
				getAiModelFamily( model ) !== getAiModelFamily( picked ) &&
				onSwitchSession &&
				sessionHasTurns
			) {
				setPendingFamilyChange( { model: picked } );
				return;
			}
			applySameFamilyModel( picked );
		},
		[ applySameFamilyModel, isModelLocked, model, onModelChange, onSwitchSession, sessionHasTurns ]
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
		const { model: pickedModel, provider: pickedProvider } = pendingFamilyChange;
		setFamilySwitchInFlight( true );
		try {
			const newSession = await openNewSession(
				{ connector, queryClient },
				ownerSiteId,
				pickedProvider ? undefined : pickedModel
			);
			if ( pickedProvider ) {
				// Pin the fresh session to the provider (with a model it
				// serves) before navigating; on failure the user re-picks
				// from the new view's dropdown.
				await connector
					.setSessionProvider( newSession.id, pickedProvider, pickedModel )
					.then( () =>
						primeSessionQueryData( queryClient, newSession, [
							createSessionContextEntry( pickedProvider, pickedModel ),
						] )
					)
					.catch( () => undefined );
			}
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, onSwitchSession, ownerSiteId, pendingFamilyChange, queryClient ] );

	const showStop = ! isField && busy && ( sending || ! hasContent );
	const canSend = hasContent && ! sending;
	const placeholder = answerQuestion
		? __( 'Your answer' )
		: placeholderOverride ??
		  /* translators: %s: the product name. */
		  sprintf( __( 'Work with %s' ), 'WordPress Studio' );
	const sendLabel = answerQuestion
		? __( 'Send answer' )
		: busy
		? __( 'Queue message' )
		: __( 'Send message' );
	const stopLabel = isInterrupting ? __( 'Force stop' ) : __( 'Stop response' );
	const addLabel = isField ? __( 'Upload attachment' ) : __( 'Add' );
	const modelLabel = getAiModelLabel( model );
	const modelDetails = [ modelLabel, AI_PROVIDER_LABELS[ sessionProvider ] ];
	if ( creditsMeter && creditsMeter.totalCredits > 0 ) {
		modelDetails.push(
			sprintf(
				/* translators: %d: percentage of AI credits left. */
				__( 'AI credits: %d%% remaining' ),
				Math.round( ( creditsMeter.remainingCredits / creditsMeter.totalCredits ) * 100 )
			)
		);
	}
	const hoveredAttachment = hoverPreview
		? attachments.find( ( attachment ) => attachment.id === hoverPreview.id )
		: undefined;

	const addButton = (
		<Tooltip.Trigger
			render={
				<button
					type="button"
					className={ styles.controlButton }
					aria-label={ addLabel }
					onClick={ isField ? openFilePicker : undefined }
				/>
			}
		>
			<Icon icon={ plus } size={ 16 } />
		</Tooltip.Trigger>
	);

	return (
		<>
			<div className={ styles.root }>
				{ isOutOfCredits ? (
					<div
						className={ styles.notice }
						role="alert"
						data-feedback={ submitFeedback ?? undefined }
					>
						<div
							className={ styles.noticeContent }
							data-submit-feedback={ submitFeedback ?? undefined }
						>
							<span className={ styles.noticeMessage }>
								{ __( 'Add AI credits to send another message.' ) }
							</span>
							<Button
								size="compact"
								variant="solid"
								tone="neutral"
								className={ styles.noticeAction }
								onClick={ openAddCredits }
							>
								{ __( 'Add credits' ) }
							</Button>
						</div>
					</div>
				) : null }
				<div
					ref={ setShellNode }
					data-session-composer
					className={ clsx( styles.shell, isField && styles.shellField ) }
					onMouseDown={ focusTextareaFromShell }
				>
					{ isDraggingFiles && fileDropTarget
						? createPortal(
								<div className={ styles.dropOverlay } aria-hidden="true">
									<span>{ __( 'Drop to attach' ) }</span>
								</div>,
								fileDropTarget
						  )
						: null }
					{ hasAttachments ? (
						<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
							{ attachments.map( ( attachment ) => {
								const imageSrc =
									attachment.kind === 'image' ? getComposerAttachmentImageSrc( attachment ) : null;
								const sizeLabel = formatComposerAttachmentSize( attachment.size );
								const showPreview = ( element: HTMLElement ) => {
									if ( hasComposerAttachmentVisualPreview( attachment ) ) {
										setHoverPreview( {
											id: attachment.id,
											...getComposerAttachmentHoverPreviewPosition( element, attachment ),
										} );
									}
								};
								const hidePreview = () =>
									setHoverPreview( ( current ) =>
										current?.id === attachment.id ? null : current
									);
								return (
									<li
										key={ attachment.id }
										className={ clsx(
											styles.attachment,
											imageSrc ? styles.attachmentImage : styles.attachmentFile
										) }
										aria-label={
											sizeLabel
												? sprintf(
														/* translators: 1: attachment file name, 2: attachment size. */
														__( '%1$s, %2$s' ),
														attachment.name,
														sizeLabel
												  )
												: attachment.name
										}
										onPointerEnter={ ( event ) => showPreview( event.currentTarget ) }
										onPointerLeave={ hidePreview }
									>
										{ imageSrc ? (
											<img className={ styles.attachmentThumb } src={ imageSrc } alt="" />
										) : (
											<>
												<Icon icon={ page } size={ 16 } />
												<span className={ styles.attachmentName }>{ attachment.name }</span>
											</>
										) }
										<button
											type="button"
											className={ styles.attachmentRemove }
											aria-label={ __( 'Remove attachment' ) }
											onClick={ () => removeAttachment( attachment.id ) }
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
									<div className={ styles.attachmentHoverArtwork }>
										{ renderAttachmentHoverVisual( hoveredAttachment ) }
									</div>
									<div className={ styles.attachmentHoverDetails }>
										<span className={ styles.attachmentHoverName }>{ hoveredAttachment.name }</span>
										<span className={ styles.attachmentHoverMeta }>
											{ [
												getComposerAttachmentTypeDescription( hoveredAttachment, __( 'File' ) ),
												formatComposerAttachmentSize( hoveredAttachment.size ),
											]
												.filter( Boolean )
												.join( ' · ' ) }
										</span>
									</div>
								</div>,
								document.body
						  )
						: null }
					<div className={ styles.inputArea }>
						{ placeholderBusy && value.length === 0 ? (
							<span className={ styles.placeholderShimmer } aria-hidden="true">
								{ placeholder }
							</span>
						) : null }
						<textarea
							ref={ textareaRef }
							className={ clsx( styles.input, placeholderBusy && styles.inputShimmering ) }
							placeholder={ placeholder }
							aria-label={
								answerQuestion ? __( 'Answer WordPress Studio' ) : __( 'Message WordPress Studio' )
							}
							value={ value }
							{ ...slash.comboboxProps }
							onChange={ ( event ) => setValue( event.target.value ) }
							onPaste={ pasteHandlers.onPaste }
							onKeyDown={ ( event ) => {
								if ( isImeComposing( event ) ) {
									return;
								}
								if ( slash.handleKeyDown( event ) ) {
									return;
								}
								if ( event.key === 'Escape' && busy ) {
									event.preventDefault();
									void onInterrupt();
									return;
								}
								if ( ! isField && event.key === 'Enter' && ! event.shiftKey ) {
									event.preventDefault();
									void send();
								}
							} }
							rows={ 1 }
						/>
						{ slash.popup }
					</div>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<Menu.Root modal={ false }>
								<Tooltip.Root>
									{ isField ? addButton : <Menu.Trigger render={ addButton } /> }
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ addLabel }
									</Tooltip.Popup>
								</Tooltip.Root>
								<Menu.Popup side="top" align="start" className={ styles.commandsMenuPopup }>
									<Menu.Item disabled={ awaitingAnswer } onClick={ openFilePicker }>
										{ __( 'Add files' ) }
									</Menu.Item>
									{ canAutoStart && ! autoStartOn ? (
										<Menu.Item
											className={ styles.describedItem }
											onClick={ () => setAutoStart( true ) }
										>
											<span className={ styles.describedItemBody }>
												<span className={ styles.describedItemLabel }>{ __( 'Auto-start' ) }</span>
												<span className={ styles.describedItemDescription }>
													{ __( 'Start stopped sites when you send a chat message.' ) }
												</span>
											</span>
										</Menu.Item>
									) : null }
									{ onEnvironmentChange && environment === 'local' && liveUrl ? (
										<Menu.Item
											className={ styles.describedItem }
											disabled={ busy }
											onClick={ () => onEnvironmentChange( 'live' ) }
										>
											<span className={ styles.describedItemBody }>
												<span className={ styles.describedItemLabel }>
													{ __( 'Work on live site' ) }
												</span>
												<span className={ styles.describedItemDescription }>{ liveUrl }</span>
											</span>
										</Menu.Item>
									) : null }
									{ onEnvironmentChange && environment === 'live' ? (
										<Menu.Item
											className={ styles.describedItem }
											disabled={ busy }
											onClick={ () => onEnvironmentChange( 'local' ) }
										>
											<span className={ styles.describedItemBody }>
												<span className={ styles.describedItemLabel }>
													{ __( 'Work on local site' ) }
												</span>
												<span className={ styles.describedItemDescription }>
													{ __( 'Work on the local site on your computer.' ) }
												</span>
											</span>
										</Menu.Item>
									) : null }
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
											{ getAiSkillCommands().map( ( command ) => (
												<Menu.Item
													key={ command.name }
													className={ styles.describedItem }
													onClick={ () => {
														void onSend( `/${ command.name }` );
													} }
												>
													<span className={ styles.describedItemBody }>
														<span className={ styles.describedItemLabel }>
															{ formatSkillLabel( command.name ) }
														</span>
														<span className={ styles.describedItemDescription }>
															{ command.description }
														</span>
													</span>
												</Menu.Item>
											) ) }
										</Menu.Popup>
									</Menu.SubmenuRoot>
								</Menu.Popup>
							</Menu.Root>
							{ autoStartOn ? (
								<ModeChip
									icon={ play }
									label={ __( 'Auto-start' ) }
									onRemove={ () => setAutoStart( false ) }
								/>
							) : null }
							{ environment === 'live' ? (
								<ModeChip
									icon={ globe }
									label={ __( 'Live' ) }
									onRemove={ () => onEnvironmentChange?.( 'local' ) }
								/>
							) : null }
							<input
								ref={ fileInputRef }
								type="file"
								multiple
								className={ styles.fileInput }
								aria-label={ __( 'Upload attachments' ) }
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
														className={ styles.modelButton }
														aria-label={ __( 'Model' ) }
														aria-description={ modelDetails.join( ' · ' ) }
													/>
												}
											>
												<span>{ modelLabel }</span>
												<Icon icon={ chevronDownSmall } size={ 16 } />
											</Tooltip.Trigger>
										}
									/>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ modelDetails.join( ' · ' ) }
									</Tooltip.Popup>
								</Tooltip.Root>
								<Menu.Popup side="top" align="end" className={ styles.modelMenuPopup }>
									{ canPickProvider ? (
										<>
											<Menu.RadioGroup
												value={ sessionProvider }
												onValueChange={ ( picked ) =>
													handleProviderChange( picked as AiProviderId )
												}
											>
												{ AI_PROVIDER_OPTIONS.map( ( { id, label } ) => (
													<Menu.RadioItem key={ id } value={ id }>
														{ label }
													</Menu.RadioItem>
												) ) }
											</Menu.RadioGroup>
											<Menu.Separator />
										</>
									) : null }
									<Menu.RadioGroup
										value={ model }
										onValueChange={ ( picked ) => handleModelChange( picked as AiModelId ) }
									>
										{ offeredModels.map( ( { id } ) => (
											<Menu.RadioItem
												key={ id }
												value={ id }
												disabled={ isModelLocked( id ) }
												className={ styles.describedItem }
											>
												<span className={ styles.describedItemBody }>
													<span className={ styles.describedItemLabel }>
														{ getAiModelLabel( id ) }
													</span>
													<span className={ styles.describedItemDescription }>
														{ isModelLocked( id )
															? sprintf(
																	/* translators: %s: what the model is good at. */
																	__( '%s · Purchased credits required' ),
																	getModelDescription( id )
															  )
															: getModelDescription( id ) }
													</span>
												</span>
											</Menu.RadioItem>
										) ) }
									</Menu.RadioGroup>
									<Menu.Separator />
									{ sessionProvider === 'wpcom' && quota ? (
										<Menu.Item onClick={ openAddCredits }>{ __( 'Get more credits' ) }</Menu.Item>
									) : null }
									<Menu.Item
										className={ styles.describedItem }
										onClick={ () => openSettings( 'ai' ) }
									>
										<span className={ styles.describedItemBody }>
											<span className={ styles.describedItemLabel }>
												{ __( 'Connect provider…' ) }
											</span>
											<span className={ styles.describedItemDescription }>
												{ __( 'Add or manage your AI providers' ) }
											</span>
										</span>
									</Menu.Item>
								</Menu.Popup>
							</Menu.Root>
							{ isField ? null : (
								<Tooltip.Root>
									<Tooltip.Trigger
										render={
											showStop ? (
												<button
													type="button"
													className={ styles.stopButton }
													onClick={ () => void onInterrupt() }
													aria-label={ stopLabel }
													aria-busy={ isInterrupting }
												/>
											) : (
												<button
													type="button"
													className={ styles.sendButton }
													data-feedback={ submitFeedback ? 'error' : undefined }
													onClick={ () => void send() }
													disabled={ ! canSend }
													aria-label={ sendLabel }
												/>
											)
										}
									>
										{ showStop ? (
											<span className={ styles.stopGlyph } aria-hidden="true" />
										) : (
											<Icon icon={ arrowUp } size={ 18 } />
										) }
									</Tooltip.Trigger>
									<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
										{ showStop ? stopLabel : sendLabel }
									</Tooltip.Popup>
								</Tooltip.Root>
							) }
						</div>
					</div>
				</div>
			</div>
			<FamilySwitchConfirmDialog
				currentModel={ model }
				pendingModel={ pendingFamilyChange?.model ?? null }
				inFlight={ familySwitchInFlight }
				onCancel={ cancelFamilyChange }
				onConfirm={ () => void confirmFamilyChange() }
			/>
			{ creditsPurchaseOpen ? (
				<AiCreditsPurchaseDialog open onOpenChange={ setCreditsPurchaseOpen } />
			) : null }
		</>
	);
} );

export const Composer = forwardRef< ComposerHandle, ComposerProps >(
	function Composer( props, ref ) {
		return <ComposerContent key={ props.sessionId } { ...props } ref={ ref } />;
	}
);
