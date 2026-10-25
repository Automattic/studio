import {
	formatComposerAttachmentSize,
	getComposerAttachmentImageSrc,
	getComposerAttachmentTextPreview,
	getComposerAttachmentTypeDescription,
	hasComposerAttachmentVisualPreview,
	watchComposerAttachmentTextScroll,
} from '@studio/common/ai/composer-attachment-preview';
import { watchComposerFilePaste } from '@studio/common/ai/composer-attachments';
import {
	aiModelRequiresPaidCredits,
	aiModelSupportsImages,
	getAiModelFamily,
	getAiModelLabel,
} from '@studio/common/ai/models';
import {
	AI_PROVIDER_IDS,
	AI_PROVIDER_LABELS,
	getAiProviderModels,
	getEffectiveSessionProvider,
	type AiProviderId,
} from '@studio/common/ai/providers';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import {
	getAiSkillCommands,
	getSlashCommandMatches,
	resolveSkillFromPrompt,
	type SkillSlashCommand,
} from '@studio/common/ai/slash-commands';
import {
	canUsePaidAiModels,
	clampQuotaFraction,
	formatQuotaPercentage,
	getStudioCodeAiAccessState,
	getTotalRemainingAiCredits,
	type StudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import {
	ArrowUpIcon,
	ChartNoAxesCombinedIcon,
	FileTextIcon,
	GaugeIcon,
	GlobeIcon,
	PaperclipIcon,
	PencilRulerIcon,
	PlayIcon,
	PlugIcon,
	PlusIcon,
	SlidersHorizontalIcon,
	SparklesIcon,
	TagsIcon,
	UnlockIcon,
	XIcon,
} from 'lucide-react';
import {
	cloneElement,
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type MouseEvent,
	type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useIsOutOfAiCredits } from '@/data/queries/use-is-out-of-ai-credits';
import {
	createModelChangeEntry,
	openNewSession,
	primeSessionQueryData,
	SESSIONS_QUERY_KEY,
} from '@/data/queries/use-sessions';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import {
	annotationSubmission,
	getAnnotationsAttachment,
	getStagedAnnotations,
	isStagedAnnotation,
	removeAnnotations,
	useSiteAnnotations,
} from '@/features/annotations';
import { AiCreditsPurchaseDialog, useAddAiCreditsUrl } from '@/features/credits';
import { useOpenSettings } from '@/features/settings';
import {
	AnnotationIcon,
	ChevronDownIcon,
	ClaudeIcon,
	McpIcon,
	StartSiteIcon,
	StopSiteIcon,
	WordPressIcon,
} from '@/lib/icons';
import { isImeComposing } from '@/lib/keyboard';
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	Popover,
	InputGroup,
	InputGroupTextarea,
	HoverCard,
	Button,
} from '@/lib/ui';
import {
	CommandSheet,
	getActiveCommand,
	handleCommandKey,
	type Command,
	type CommandGroup,
} from '@/lib/ui';
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
import type {
	AiModelId,
	LoadedAiSession,
	SessionEntry,
	StudioChatFileAttachment,
	StudioChatImage,
	StudioVisualAnnotationSummary,
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

function AttachmentChip( {
	attachment,
	isAnnotations,
	onRemove,
}: {
	attachment: ComposerAttachment;
	isAnnotations: boolean;
	onRemove: () => void;
} ) {
	const imageSrc = attachment.kind === 'image' ? getComposerAttachmentImageSrc( attachment ) : null;
	const sizeLabel = formatComposerAttachmentSize( attachment.size );
	const chip = (
		<li
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
		/>
	);
	const content = (
		<>
			{ imageSrc ? (
				<img className={ styles.attachmentThumb } src={ imageSrc } alt="" />
			) : (
				<>
					{ isAnnotations ? <AnnotationIcon /> : <FileTextIcon /> }
					<span className={ styles.attachmentName }>{ attachment.name }</span>
				</>
			) }
			<Button
				variant="outline"
				size="icon-2xs"
				shape="round"
				className={ styles.attachmentRemove }
				aria-label={ __( 'Remove attachment' ) }
				onClick={ onRemove }
			>
				<XIcon />
			</Button>
		</>
	);
	if ( ! hasComposerAttachmentVisualPreview( attachment ) ) {
		return cloneElement( chip, {}, content );
	}
	return (
		<HoverCard.Root>
			<HoverCard.Trigger render={ chip }>{ content }</HoverCard.Trigger>
			<HoverCard.Popup
				side="top"
				align="start"
				sideOffset={ 8 }
				className={ styles.attachmentHoverPreview }
			>
				<div className={ styles.attachmentHoverArtwork }>
					{ renderAttachmentHoverVisual( attachment ) }
				</div>
				<div className={ styles.attachmentHoverDetails }>
					<span className={ styles.attachmentHoverName }>{ attachment.name }</span>
					<span className={ styles.attachmentHoverMeta }>
						{ [ getComposerAttachmentTypeDescription( attachment, __( 'File' ) ), sizeLabel ]
							.filter( Boolean )
							.join( ' · ' ) }
					</span>
				</div>
			</HoverCard.Popup>
		</HoverCard.Root>
	);
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

// Accounts on the older monthly cap have no credit counts, only usage against the cap.
function getCreditsLabel( quota: StudioAssistantQuota | null | undefined, locale?: string ) {
	const remaining = quota ? getTotalRemainingAiCredits( quota ) : undefined;
	if ( remaining !== undefined ) {
		return {
			hasCredits: true,
			label:
				remaining <= 0
					? __( 'No AI credits remaining' )
					: sprintf(
							/* translators: %s: compact number of AI credits remaining (e.g. 200K or 1.5M). */
							__( 'AI credits: %s remaining' ),
							new Intl.NumberFormat( locale, {
								notation: 'compact',
								maximumFractionDigits: 1,
							} ).format( remaining )
					  ),
		};
	}
	if ( ! quota || quota.costCap <= 0 ) {
		return { hasCredits: false, label: __( 'AI usage unavailable' ) };
	}
	return {
		hasCredits: false,
		label: sprintf(
			/* translators: %s: percentage of the AI allowance left. */
			__( 'AI allowance: %s remaining' ),
			formatQuotaPercentage( 1 - clampQuotaFraction( quota.costUsage, quota.costCap ), locale )
		),
	};
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

const COMMAND_ICONS: Partial< Record< string, ComponentType< { className?: string } > > > = {
	annotate: PencilRulerIcon,
	taxonomist: TagsIcon,
	'need-for-speed': GaugeIcon,
	'rank-me-up': ChartNoAxesCombinedIcon,
	liberate: UnlockIcon,
	'auto-start': StartSiteIcon,
	'connect-provider': McpIcon,
	model: SlidersHorizontalIcon,
	live: GlobeIcon,
	local: PlayIcon,
};

// A blocked send shakes the notice, then holds it in the error color briefly.
const SUBMIT_SHAKE_MS = 240;
const SUBMIT_FEEDBACK_MS = 900;

// A mode the composer is in; hovering offers to remove it.
function ModeChip( {
	icon: ModeIcon,
	label,
	onRemove,
	disabled,
}: {
	icon: ComponentType< { className?: string } >;
	label: string;
	onRemove: () => void;
	disabled?: boolean;
} ) {
	const removeLabel = sprintf(
		/* translators: %s: name of a composer mode, e.g. "Auto-start". */
		__( 'Remove %s' ),
		label
	);
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						shape="round"
						className={ styles.modeChip }
						aria-label={ removeLabel }
						disabled={ disabled }
						onClick={ onRemove }
					/>
				}
			>
				<span className={ styles.modeChipIcon }>
					<ModeIcon />
					<XIcon />
				</span>
				{ label }
			</TooltipTrigger>
			<TooltipContent>{ removeLabel }</TooltipContent>
		</Tooltip>
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
					<Button size="icon" />
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
		options?: ComposerSendAttachments & {
			displayMessage?: string;
			visualAnnotations?: StudioVisualAnnotationSummary[];
		}
	) => Promise< void >;
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
	// The site whose preview annotations go out with the next message.
	annotationSiteId?: string;
	onModelChange?: ( model: AiModelId ) => void;
	// Why the chat can't send right now; a send attempt shakes it.
	notice?: ComposerNotice;
}

export interface ComposerNotice {
	message: string;
	action?: { label: string; onClick: () => void };
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
		}
	): void;
	getSubmission(): { prompt: string; attachments: ComposerSendAttachments } | null;
	focus(): void;
	send(): Promise< void >;
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
		annotationSiteId,
		onModelChange,
		notice: blockingNotice,
	},
	ref
) {
	const isField = variant === 'field';
	const [ initialDraft ] = useState( () => getComposerDraft( sessionId ) );
	const [ value, setValue ] = useState( initialDraft.text );
	const [ sending, setSending ] = useState( false );
	const [ addOpen, setAddOpen ] = useState( false );
	const [ dismissedText, setDismissedText ] = useState< string | null >( null );
	const [ highlight, setHighlight ] = useState< string >();
	const [ modelOpen, setModelOpen ] = useState( false );
	const [ modelHighlight, setModelHighlight ] = useState< string >();
	const [ submitFeedback, setSubmitFeedback ] = useState< 'shake' | 'error' | null >( null );
	const [ shellNode, setShellNode ] = useState< HTMLDivElement | null >( null );
	const [ rootNode, setRootNode ] = useState< HTMLDivElement | null >( null );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const insertedCursorRef = useRef< number | null >( null );
	const commandListRef = useRef< HTMLDivElement | null >( null );
	const modelListRef = useRef< HTMLDivElement | null >( null );
	const modelTriggerRef = useRef< HTMLButtonElement | null >( null );
	const pendingCommandRef = useRef< ( () => void ) | undefined >( undefined );
	const slashListId = useId();
	const draftEffectInitializedRef = useRef( false );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const openSettings = useOpenSettings();

	const { data: aiSettings } = useAiSettings();
	const sessionProvider = useMemo(
		() => getEffectiveSessionProvider( entries ?? [], aiSettings ),
		[ entries, aiSettings ]
	);

	// The paid tiers are listed but disabled for accounts without purchased
	// credits; Automatticians are exempt.
	const {
		data: quota,
		isError: isQuotaError,
		refetch: refetchQuota,
	} = useStudioAssistantQuota( { refetchOnWindowFocus: 'always' } );
	const { data: authUser } = useAuthUser();
	// The providers this chat can use; another provider's model starts a new
	// chat, which needs a session to come from.
	const providers = AI_PROVIDER_IDS.filter(
		( id ) =>
			( id === 'wpcom' ? !! authUser : aiSettings?.hasAnthropicApiKey ) &&
			( !! sessionId || id === sessionProvider )
	);
	const canUsePaidTiers = canUsePaidAiModels( quota, authUser?.email );
	const isModelLocked = useCallback(
		( id: AiModelId ) => aiModelRequiresPaidCredits( id ) && ! canUsePaidTiers,
		[ canUsePaidTiers ]
	);
	const isWpcom = sessionProvider === 'wpcom';
	const isOutOfCredits = useIsOutOfAiCredits() && ! isField && isWpcom;

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
	const notice =
		blockingNotice ??
		( isOutOfCredits
			? {
					message: __( 'Add AI credits to send another message.' ),
					action: { label: __( 'Add credits' ), onClick: openAddCredits },
			  }
			: undefined );

	const { data: preferences } = useUserPreferences();
	const savePreferences = useSaveUserPreferences();
	const autoStartOn = canAutoStart && preferences?.autoStartSiteOnChat === true;
	const setAutoStart = ( autoStartSiteOnChat: boolean ) =>
		savePreferences.mutate( { autoStartSiteOnChat } );

	const composerCommands: SkillSlashCommand[] = [
		...( canAutoStart && ! autoStartOn
			? [
					{
						name: 'auto-start',
						displayName: __( 'Auto-start' ),
						description: __( 'Start stopped sites when you send a chat message.' ),
					},
			  ]
			: [] ),
		...( busy || ! providers.length
			? []
			: [
					{
						name: 'model',
						displayName: __( 'Choose model' ),
						description: __( 'Select a model for this chat.' ),
					},
			  ] ),
		{
			name: 'connect-provider',
			displayName: __( 'Connect AI providers' ),
			description: __( 'Use WordPress.com AI credits or your own API key.' ),
		},
		...( onEnvironmentChange && environment === 'local' && liveUrl
			? [ { name: 'live', displayName: __( 'Work on live site' ), description: liveUrl } ]
			: [] ),
		...( onEnvironmentChange && environment === 'live'
			? [
					{
						name: 'local',
						displayName: __( 'Work on local site' ),
						description: __( 'Work on the local site on your computer.' ),
					},
			  ]
			: [] ),
	];
	const skills = getAiSkillCommands();
	const isSkill = ( command: SkillSlashCommand ) =>
		skills.some( ( skill ) => skill.name === command.name );
	const slash = getSlashCommandMatches( value, null, composerCommands );
	const sheetOpen = addOpen || ( slash.open && dismissedText !== value );

	const closeSheet = () => {
		setAddOpen( false );
		setDismissedText( value );
	};

	// Replaces the `/fragment` before the cursor: a skill lands as `/name`, an
	// action runs and leaves the draft without its fragment.
	const runCommand = ( name: string ) => {
		closeSheet();
		if ( name === 'add-files' ) {
			fileInputRef.current?.click();
			return;
		}
		const start = textareaRef.current?.selectionStart ?? value.length;
		const end = textareaRef.current?.selectionEnd ?? start;
		const before = value.slice( 0, start );
		const after = value.slice( end );
		const fragment = /(?:^|\s)(\/[\w-]*)$/.exec( before );
		const prefix = fragment ? before.slice( 0, -fragment[ 1 ].length ) : before;
		const setDraft = ( text: string, cursor: number ) => {
			insertedCursorRef.current = cursor;
			setValue( text );
			textareaRef.current?.focus();
		};
		if ( skills.some( ( skill ) => skill.name === name ) ) {
			const command = `${ prefix && ! /\s$/.test( prefix ) ? ' ' : '' }/${ name }${
				/^\s/.test( after ) ? '' : ' '
			}`;
			setDraft(
				prefix + command + after,
				prefix.length + command.length + ( /^\s/.test( after ) ? 1 : 0 )
			);
			return;
		}
		if ( name === 'model' ) {
			pendingCommandRef.current = () => setModelOpen( true );
		} else if ( name === 'connect-provider' ) {
			openSettings( 'ai' );
		} else if ( name === 'live' || name === 'local' ) {
			onEnvironmentChange?.( name );
		} else if ( name === 'auto-start' ) {
			setAutoStart( true );
		}
		if ( fragment ) {
			setDraft( prefix + after, prefix.length );
		}
	};

	const toCommand = ( command: SkillSlashCommand ): Command => ( {
		value: command.name,
		label: command.displayName ?? command.name,
		description: command.description,
		icon: COMMAND_ICONS[ command.name ] ?? SparklesIcon,
		disabled:
			( command.name === 'auto-start' && ( ! preferences || savePreferences.isPending ) ) ||
			( ( command.name === 'live' || command.name === 'local' ) && busy ),
	} );
	const commandGroups: CommandGroup[] = [
		{
			label: __( 'Commands' ),
			items: [
				...( addOpen
					? [ { value: 'add-files', label: __( 'Add files' ), icon: PaperclipIcon } ]
					: [] ),
				...( addOpen
					? composerCommands
					: slash.matches.filter( ( command ) => ! isSkill( command ) )
				).map( toCommand ),
			],
		},
		{
			label: __( 'Skills' ),
			heading: __( 'Skills' ),
			items: ( addOpen ? skills : slash.matches.filter( isSkill ) ).map( toCommand ),
		},
	];
	const activeCommand = sheetOpen ? getActiveCommand( commandGroups, highlight ) : undefined;

	useLayoutEffect( () => {
		const cursor = insertedCursorRef.current;
		if ( cursor !== null ) {
			textareaRef.current?.setSelectionRange( cursor, cursor );
			insertedCursorRef.current = null;
		}
	}, [ value ] );

	// File/image attachments (attach button, drop and paste). Images ride as
	// base64 content blocks; other files are referenced by disk path.
	const {
		attachments,
		addFiles,
		removeAttachment,
		removeAttachments,
		restore: restoreAttachments,
		pasteHandlers,
	} = useComposerAttachments( initialDraft.attachments );
	const hasAttachments = attachments.length > 0;
	const { notes } = useSiteAnnotations( annotationSiteId );
	const stagedNotes = useMemo( () => notes.filter( isStagedAnnotation ), [ notes ] );
	const annotationsAttachment = stagedNotes.length ? getAnnotationsAttachment( stagedNotes ) : null;
	const shownAttachments = annotationsAttachment
		? [ annotationsAttachment, ...attachments ]
		: attachments;
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
			saveComposerDraft( sessionId, { text: value, attachments } );
		} else {
			draftEffectInitializedRef.current = true;
		}
	}, [ attachments, sessionId, value ] );

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

	const answerQuestion =
		onAnswer && ! hasAttachments && ! resolveSkillFromPrompt( value ) ? onAnswer : undefined;
	// Notes wait for the agent to finish: they point at the page as it is now.
	const hasContent =
		value.trim().length > 0 || hasAttachments || ( ! busy && stagedNotes.length > 0 );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		// Read at send time: the preview may have staged notes a moment ago.
		const sentNotes = busy ? [] : getStagedAnnotations( annotationSiteId );
		if ( sending || ( ! trimmed && attachments.length === 0 && sentNotes.length === 0 ) ) {
			return;
		}
		if ( blockingNotice || isOutOfCredits ) {
			setSubmitFeedback( 'shake' );
			return;
		}
		if ( answerQuestion && trimmed ) {
			setValue( '' );
			answerQuestion( trimmed );
			return;
		}
		let submission;
		try {
			submission = sentNotes.length
				? annotationSubmission( trimmed, attachments, sentNotes )
				: {
						prompt: trimmed || __( 'Please review the attached files.' ),
						options: toComposerSendAttachments( attachments ),
				  };
		} catch ( error ) {
			toast.error( ( error as Error ).message );
			return;
		}
		if ( submission.options.images?.length && ! aiModelSupportsImages( model ) ) {
			toast.error( __( 'Choose a model that supports images before sending these attachments.' ) );
			return;
		}
		// The draft stays editable until the send is accepted; only then is what
		// was sent removed, keeping anything typed or attached in the meantime.
		const sentIds = new Set( attachments.map( ( item ) => item.id ) );
		setSending( true );
		try {
			await onSend( submission.prompt, submission.options );
		} catch {
			// The parent reports the failure in a toast; the draft is untouched.
			return;
		} finally {
			setSending( false );
		}
		completeComposerDraftSend( sessionId, trimmed, sentIds );
		if ( ( textareaRef.current?.value ?? '' ).trim() === trimmed ) {
			setValue( '' );
		}
		removeAttachments( sentIds );
		if ( annotationSiteId && sentNotes.length ) {
			removeAnnotations(
				annotationSiteId,
				sentNotes.map( ( note ) => note.id )
			);
		}
	}, [
		value,
		sending,
		attachments,
		busy,
		blockingNotice,
		isOutOfCredits,
		answerQuestion,
		onSend,
		sessionId,
		removeAttachments,
		annotationSiteId,
		model,
	] );

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
				restoreAttachments( toComposerDraftAttachments( options ?? {} ) );
				queueMicrotask( () => focusAtEnd( textareaRef.current ) );
			},
			getSubmission() {
				const prompt = value.trim();
				if ( ! prompt && attachments.length === 0 ) return null;
				return { prompt, attachments: toComposerSendAttachments( attachments ) };
			},
			focus() {
				focusAtEnd( textareaRef.current );
			},
			send,
		} ),
		[ restoreAttachments, value, attachments, send ]
	);

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

	// Pin this conversation to a provider and one of its models in the same
	// entry. Providers don't share a model family, so the switch goes through
	// the same fresh-session confirmation as a cross-family model switch.
	const handleProviderChange = useCallback(
		( picked: AiProviderId, nextModel: AiModelId ) => {
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
		[ appendEntryOptimistically, connector, model, onSwitchSession, sessionHasTurns ]
	);

	const handleModelChange = useCallback(
		( provider: AiProviderId, picked: AiModelId ) => {
			if ( picked === model || isModelLocked( picked ) ) {
				return;
			}
			if ( provider !== sessionProvider ) {
				handleProviderChange( provider, picked );
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
		[
			applySameFamilyModel,
			handleProviderChange,
			isModelLocked,
			model,
			onModelChange,
			onSwitchSession,
			sessionHasTurns,
			sessionProvider,
		]
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
			saveComposerDraft( newSession.id, { text: value, attachments } );
			setPendingFamilyChange( null );
			onSwitchSession( newSession.id );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [
		attachments,
		connector,
		onSwitchSession,
		ownerSiteId,
		pendingFamilyChange,
		queryClient,
		value,
	] );

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
	const credits = getCreditsLabel( isQuotaError ? null : quota, preferences?.locale );
	const canPurchaseCredits =
		isWpcom &&
		!! quota &&
		credits.hasCredits &&
		! isQuotaError &&
		getStudioCodeAiAccessState( quota ) === 'available' &&
		quota.hasPaymentMethod;
	const modelDetails = [ modelLabel, AI_PROVIDER_LABELS[ sessionProvider ] ];
	if ( isWpcom ) {
		modelDetails.push( credits.label );
	}
	const pickModelCommand = ( value: string ) => {
		setModelOpen( false );
		if ( value === 'get-credits' ) {
			openAddCredits();
		} else if ( value === 'connect-provider' ) {
			openSettings( 'ai' );
		} else {
			const provider = providers.find( ( id ) =>
				getAiProviderModels( id ).some( ( item ) => item.id === value )
			);
			if ( provider ) {
				handleModelChange( provider, value as AiModelId );
			}
		}
	};
	const modelGroups: CommandGroup[] = [
		{
			label: __( 'Models' ),
			items: providers.flatMap( ( provider ) =>
				getAiProviderModels( provider ).map( ( { id } ): Command => {
					const description = sprintf(
						/* translators: 1: the model's provider, 2: what the model is good at. */
						__( '%1$s · %2$s' ),
						provider === 'wpcom' ? 'WordPress' : 'Claude',
						getModelDescription( id )
					);
					return {
						value: id,
						label: getAiModelLabel( id ),
						description: isModelLocked( id )
							? `${ description } · ${ __( 'Purchased credits required' ) }`
							: description,
						icon: provider === 'wpcom' ? WordPressIcon : ClaudeIcon,
						disabled: isModelLocked( id ),
					};
				} )
			),
		},
		{
			label: __( 'Actions' ),
			heading: __( 'Actions' ),
			items: [
				...( canPurchaseCredits
					? [
							{
								value: 'get-credits',
								label: __( 'Get more credits' ),
								description: credits.label,
								icon: PlusIcon,
							},
					  ]
					: [] ),
				{
					value: 'connect-provider',
					label: __( 'Connect provider…' ),
					description: __( 'Add or manage your AI providers' ),
					icon: PlugIcon,
				},
			],
		},
	];

	const addButton = (
		<Button
			variant="ghost"
			size="icon"
			shape="round"
			aria-label={ addLabel }
			onClick={ isField ? openFilePicker : undefined }
		>
			<PlusIcon />
		</Button>
	);

	return (
		<Popover.Root
			open={ sheetOpen }
			onOpenChange={ ( open, details ) => {
				if ( details.reason === 'trigger-press' && ! addOpen ) {
					setAddOpen( true );
					return;
				}
				setAddOpen( open );
				if ( ! open ) {
					setDismissedText( value );
				}
			} }
			onOpenChangeComplete={ ( open ) => {
				const pending = pendingCommandRef.current;
				pendingCommandRef.current = undefined;
				if ( ! open ) {
					pending?.();
				}
			} }
		>
			<div className={ styles.root } ref={ setRootNode }>
				{ notice ? (
					<div
						className={ styles.notice }
						role="alert"
						data-feedback={ submitFeedback ?? undefined }
					>
						<div
							className={ styles.noticeContent }
							data-submit-feedback={ submitFeedback ?? undefined }
						>
							<span className={ styles.noticeMessage }>{ notice.message }</span>
							{ notice.action ? (
								<Button
									size="composer-notice"
									shape="round"
									variant={ submitFeedback ? 'destructive' : 'default' }
									onClick={ notice.action.onClick }
								>
									{ notice.action.label }
								</Button>
							) : null }
						</div>
					</div>
				) : null }
				<InputGroup
					ref={ setShellNode }
					variant="composer"
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
					{ shownAttachments.length ? (
						<ul className={ styles.attachments } aria-label={ __( 'Attachments' ) }>
							{ shownAttachments.map( ( attachment ) => (
								<AttachmentChip
									key={ attachment.id }
									attachment={ attachment }
									isAnnotations={ attachment === annotationsAttachment }
									onRemove={ () =>
										attachment === annotationsAttachment && annotationSiteId
											? removeAnnotations(
													annotationSiteId,
													stagedNotes.map( ( note ) => note.id )
											  )
											: removeAttachment( attachment.id )
									}
								/>
							) ) }
						</ul>
					) : null }
					<div className={ styles.inputArea }>
						{ placeholderBusy && value.length === 0 ? (
							<span className={ styles.placeholder } aria-hidden="true">
								<span className="studio-shimmer">{ placeholder }</span>
							</span>
						) : null }
						<InputGroupTextarea
							ref={ textareaRef }
							className={ clsx( styles.input, placeholderBusy && styles.inputShimmering ) }
							placeholder={ placeholder }
							aria-label={
								answerQuestion ? __( 'Answer WordPress Studio' ) : __( 'Message WordPress Studio' )
							}
							value={ value }
							role="combobox"
							aria-autocomplete="list"
							aria-haspopup="listbox"
							aria-expanded={ sheetOpen && ! addOpen }
							aria-controls={ sheetOpen && ! addOpen ? slashListId : undefined }
							aria-activedescendant={
								! addOpen && activeCommand ? `${ slashListId }-${ activeCommand.value }` : undefined
							}
							onChange={ ( event ) => {
								setValue( event.target.value );
								setDismissedText( null );
								setHighlight( undefined );
							} }
							onPaste={ pasteHandlers.onPaste }
							onKeyDown={ ( event ) => {
								if ( isImeComposing( event ) ) {
									return;
								}
								if (
									sheetOpen &&
									! addOpen &&
									handleCommandKey( event, commandGroups, highlight, setHighlight, runCommand )
								) {
									return;
								}
								if ( event.key === 'Escape' && sheetOpen ) {
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
					</div>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							{ isField ? addButton : <Popover.Trigger render={ addButton } /> }
							{ autoStartOn ? (
								<ModeChip
									icon={ StartSiteIcon }
									label={ __( 'Auto-start' ) }
									onRemove={ () => setAutoStart( false ) }
								/>
							) : null }
							{ environment === 'live' ? (
								<ModeChip
									icon={ GlobeIcon }
									label={ __( 'Live' ) }
									disabled={ busy }
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
							{ providers.length ? (
								<Popover.Root
									open={ modelOpen }
									onOpenChange={ ( open ) => {
										setModelOpen( open );
										if ( open ) {
											setModelHighlight( model );
											if ( isWpcom ) {
												void refetchQuota();
											}
										}
									} }
								>
									<Popover.Trigger
										render={
											<Button
												ref={ modelTriggerRef }
												variant="ghost"
												shape="round"
												aria-label={ __( 'Model' ) }
												aria-description={ modelDetails.join( ' · ' ) }
												title={ modelDetails.join( ' · ' ) }
												disabled={ busy }
											/>
										}
									>
										<span>{ modelLabel }</span>
										<ChevronDownIcon data-icon="inline-end" data-dropdown-indicator />
									</Popover.Trigger>
									<CommandSheet
										label={ __( 'Choose a model' ) }
										groups={ modelGroups }
										highlighted={ modelHighlight }
										onHighlight={ setModelHighlight }
										onSelect={ pickModelCommand }
										listRef={ modelListRef }
										anchor={ rootNode }
										initialFocus={ modelListRef }
										finalFocus={ modelTriggerRef }
									/>
								</Popover.Root>
							) : null }
							{ isField ? null : showStop ? (
								<Button
									size="icon"
									shape="round"
									className={ styles.stopButton }
									onClick={ () => void onInterrupt() }
									aria-label={ stopLabel }
									aria-busy={ isInterrupting }
								>
									<StopSiteIcon fill="currentColor" />
								</Button>
							) : (
								<Button
									variant={ submitFeedback ? 'destructive' : canSend ? 'accent' : 'default' }
									size="icon"
									shape="round"
									onClick={ () => void send() }
									disabled={ ! canSend }
									aria-label={ sendLabel }
								>
									<ArrowUpIcon />
								</Button>
							) }
						</div>
					</div>
				</InputGroup>
			</div>
			<CommandSheet
				label={ __( 'Commands' ) }
				groups={ commandGroups }
				highlighted={ highlight }
				onHighlight={ setHighlight }
				onSelect={ runCommand }
				listRef={ commandListRef }
				id={ slashListId }
				anchor={ rootNode }
				initialFocus={ () => ( addOpen ? commandListRef.current : false ) }
				finalFocus={ () => ( pendingCommandRef.current ? false : textareaRef.current ) }
			/>
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
		</Popover.Root>
	);
} );

export const Composer = forwardRef< ComposerHandle, ComposerProps >(
	function Composer( props, ref ) {
		return <ComposerContent key={ props.sessionId } { ...props } ref={ ref } />;
	}
);
