import { aiModelSupportsImages } from '@studio/common/ai/models';
import { resolveSkillFromPrompt } from '@studio/common/ai/slash-commands';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { GlobeIcon, PlusIcon } from 'lucide-react';
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from '@/data/app-messages';
import { useIsOutOfAiCredits } from '@/data/queries/use-is-out-of-ai-credits';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { getStagedAnnotations, removeAnnotations } from '@/features/annotations';
import { AttachmentChips } from '@/features/composer/attachment-chips';
import { applyCommandToDraft, getComposerCommands } from '@/features/composer/composer-commands';
import { composerSubmission } from '@/features/composer/composer-submission';
import {
	completeComposerDraftSend,
	getComposerDraft,
	saveComposerDraft,
} from '@/features/composer/draft-store';
import { FamilySwitchConfirmDialog } from '@/features/composer/family-switch-confirm-dialog';
import { ModeChip } from '@/features/composer/mode-chip';
import { ModelPicker } from '@/features/composer/model-picker';
import { NoticeTab, type ComposerNotice } from '@/features/composer/notice-tab';
import { SendButton, StopButton } from '@/features/composer/submit-button';
import { useAddCredits } from '@/features/composer/use-add-credits';
import { useCommandSheet } from '@/features/composer/use-command-sheet';
import { useComposerHandle, type ComposerHandle } from '@/features/composer/use-composer-handle';
import { useDraftAttachments } from '@/features/composer/use-draft-attachments';
import { useModelAccess } from '@/features/composer/use-model-access';
import { useModelSwitch } from '@/features/composer/use-model-switch';
import { useSubmitFeedback } from '@/features/composer/use-submit-feedback';
import { AiCreditsPurchaseDialog } from '@/features/credits';
import { StartSiteIcon } from '@/lib/icons';
import { isImeComposing } from '@/lib/keyboard';
import {
	Button,
	CommandSheet,
	handleCommandKey,
	InputGroup,
	InputGroupTextarea,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { AiModelId, SessionEntry, StudioVisualAnnotationSummary } from '@/data/core';
import type { ComposerSendAttachments } from '@/data/use-composer-attachments';

/**
 * Invisible structural placeholder that mirrors Composer's outer DOM, so the
 * loading state reserves the same vertical space without a visible composer.
 */
export function ComposerSkeleton() {
	return (
		<div className={ styles.root } style={ { visibility: 'hidden' } } inert>
			<div className={ styles.shell }>
				<textarea className={ styles.input } rows={ 1 } />
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
	const [ modelOpen, setModelOpen ] = useState( false );
	const { feedback: submitFeedback, shake } = useSubmitFeedback();
	const [ shellNode, setShellNode ] = useState< HTMLDivElement | null >( null );
	const [ rootNode, setRootNode ] = useState< HTMLDivElement | null >( null );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const fileInputRef = useRef< HTMLInputElement | null >( null );
	const insertedCursorRef = useRef< number | null >( null );
	const commandListRef = useRef< HTMLDivElement | null >( null );
	const pendingCommandRef = useRef< ( () => void ) | undefined >( undefined );
	const slashListId = useId();
	const draftEffectInitializedRef = useRef( false );
	const openSettings = useOpenSettings();

	const { sessionProvider, providers, isModelLocked } = useModelAccess( { sessionId, entries } );
	const isWpcom = sessionProvider === 'wpcom';
	const isOutOfCredits = useIsOutOfAiCredits() && ! isField && isWpcom;
	const { openAddCredits, purchaseOpen, setPurchaseOpen } = useAddCredits();
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

	const sheet = useCommandSheet( {
		value,
		commands: getComposerCommands( {
			canAutoStart,
			autoStartOn,
			canChooseModel: ! busy && providers.length > 0,
			environment,
			liveUrl,
			canChangeEnvironment: !! onEnvironmentChange,
		} ),
		isDisabled: ( name ) =>
			( name === 'auto-start' && ( ! preferences || savePreferences.isPending ) ) ||
			( ( name === 'live' || name === 'local' ) && busy ),
	} );

	// Replaces the `/fragment` before the cursor: a skill lands as `/name`, an
	// action runs and leaves the draft without its fragment.
	const runCommand = ( name: string ) => {
		sheet.close();
		if ( name === 'add-files' ) {
			fileInputRef.current?.click();
			return;
		}
		const start = textareaRef.current?.selectionStart ?? value.length;
		const end = textareaRef.current?.selectionEnd ?? start;
		const isSkill = sheet.skills.some( ( skill ) => skill.name === name );
		const draft = applyCommandToDraft( value, start, end, name, isSkill );
		if ( ! isSkill ) {
			if ( name === 'model' ) {
				pendingCommandRef.current = () => setModelOpen( true );
			} else if ( name === 'connect-provider' ) {
				openSettings( 'ai' );
			} else if ( name === 'live' || name === 'local' ) {
				onEnvironmentChange?.( name );
			} else if ( name === 'auto-start' ) {
				setAutoStart( true );
			}
		}
		if ( draft ) {
			insertedCursorRef.current = draft.cursor;
			setValue( draft.text );
			textareaRef.current?.focus();
		}
	};

	useLayoutEffect( () => {
		const cursor = insertedCursorRef.current;
		if ( cursor !== null ) {
			textareaRef.current?.setSelectionRange( cursor, cursor );
			insertedCursorRef.current = null;
		}
	}, [ value ] );

	const fileDropTarget = dropTarget ?? shellNode;
	const {
		attachments,
		removeAttachments,
		restoreAttachments,
		pasteHandlers,
		stagedNotes,
		annotationsAttachment,
		shownAttachments,
		removeShownAttachment,
		isDraggingFiles,
		onFileInputChange,
	} = useDraftAttachments( {
		initialAttachments: initialDraft.attachments,
		annotationSiteId,
		dropTarget: fileDropTarget,
		textareaRef,
	} );
	const hasAttachments = attachments.length > 0;

	useEffect( () => {
		if ( draftEffectInitializedRef.current ) {
			saveComposerDraft( sessionId, { text: value, attachments } );
		} else {
			draftEffectInitializedRef.current = true;
		}
	}, [ attachments, sessionId, value ] );

	const {
		changeModel,
		pendingModel,
		familySwitchInFlight,
		cancelFamilyChange,
		confirmFamilyChange,
	} = useModelSwitch( {
		model,
		sessionId,
		entries,
		sessionProvider,
		ownerSiteId,
		onSwitchSession,
		onModelChange,
		isModelLocked,
		text: value,
		attachments,
	} );

	useEffect( () => {
		if ( autoFocus ) {
			textareaRef.current?.focus();
		}
	}, [ autoFocus, sessionId ] );

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
			shake();
			return;
		}
		if ( answerQuestion && trimmed ) {
			setValue( '' );
			answerQuestion( trimmed );
			return;
		}
		let submission;
		try {
			submission = composerSubmission( trimmed, attachments, sentNotes );
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
		shake,
		answerQuestion,
		onSend,
		sessionId,
		removeAttachments,
		annotationSiteId,
		model,
	] );

	useComposerHandle( ref, {
		value,
		setValue,
		attachments,
		restoreAttachments,
		textareaRef,
		send,
	} );

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
	const addLabel = isField ? __( 'Upload attachment' ) : __( 'Add' );

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
			open={ sheet.open }
			onOpenChange={ sheet.onOpenChange }
			onOpenChangeComplete={ ( open ) => {
				const pending = pendingCommandRef.current;
				pendingCommandRef.current = undefined;
				if ( ! open ) {
					pending?.();
				}
			} }
		>
			<div className={ styles.root } ref={ setRootNode }>
				{ notice ? <NoticeTab notice={ notice } feedback={ submitFeedback } /> : null }
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
						<AttachmentChips
							attachments={ shownAttachments }
							annotationsAttachment={ annotationsAttachment }
							onRemove={ removeShownAttachment }
						/>
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
							aria-expanded={ sheet.open && ! sheet.addOpen }
							aria-controls={ sheet.open && ! sheet.addOpen ? slashListId : undefined }
							aria-activedescendant={
								! sheet.addOpen && sheet.activeCommand
									? `${ slashListId }-${ sheet.activeCommand.value }`
									: undefined
							}
							onChange={ ( event ) => {
								setValue( event.target.value );
								sheet.onDraftChange();
							} }
							onPaste={ pasteHandlers.onPaste }
							onKeyDown={ ( event ) => {
								if ( isImeComposing( event ) ) {
									return;
								}
								if (
									sheet.open &&
									! sheet.addOpen &&
									handleCommandKey(
										event,
										sheet.groups,
										sheet.highlight,
										sheet.setHighlight,
										runCommand
									)
								) {
									return;
								}
								if ( event.key === 'Escape' && sheet.open ) {
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
								<ModelPicker
									open={ modelOpen }
									onOpenChange={ setModelOpen }
									model={ model }
									providers={ providers }
									sessionProvider={ sessionProvider }
									isModelLocked={ isModelLocked }
									disabled={ busy }
									anchor={ rootNode }
									onChange={ changeModel }
									onAddCredits={ openAddCredits }
								/>
							) : null }
							{ isField ? null : showStop ? (
								<StopButton isInterrupting={ isInterrupting } onStop={ () => void onInterrupt() } />
							) : (
								<SendButton
									label={ sendLabel }
									canSend={ canSend }
									feedback={ submitFeedback }
									onSend={ () => void send() }
								/>
							) }
						</div>
					</div>
				</InputGroup>
			</div>
			<CommandSheet
				label={ __( 'Commands' ) }
				groups={ sheet.groups }
				highlighted={ sheet.highlight }
				onHighlight={ sheet.setHighlight }
				onSelect={ runCommand }
				listRef={ commandListRef }
				id={ slashListId }
				anchor={ rootNode }
				initialFocus={ () => ( sheet.addOpen ? commandListRef.current : false ) }
				finalFocus={ () => ( pendingCommandRef.current ? false : textareaRef.current ) }
			/>
			<FamilySwitchConfirmDialog
				currentModel={ model }
				pendingModel={ pendingModel }
				inFlight={ familySwitchInFlight }
				onCancel={ cancelFamilyChange }
				onConfirm={ () => void confirmFamilyChange() }
			/>
			{ purchaseOpen ? <AiCreditsPurchaseDialog open onOpenChange={ setPurchaseOpen } /> : null }
		</Popover.Root>
	);
} );

export const Composer = forwardRef< ComposerHandle, ComposerProps >(
	function Composer( props, ref ) {
		return <ComposerContent key={ props.sessionId } { ...props } ref={ ref } />;
	}
);
