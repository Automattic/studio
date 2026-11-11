import { resolveSkillFromPrompt } from '@studio/agent/protocol/slash-commands';
import { getAiModel, type ProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { GlobeIcon } from 'lucide-react';
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
import { useIsOutOfAiCredits } from '@/data/queries/use-is-out-of-ai-credits';
import { useSaveUserPreferences, useUserPreferences } from '@/data/queries/use-user-preferences';
import { useOpenSettings } from '@/data/use-open-settings';
import { usePanelCommand } from '@/data/use-panel-command';
import {
	getStagedAnnotations,
	removeAnnotations,
	type PreviewAnnotation,
} from '@/features/annotations';
import { AttachmentChips } from '@/features/composer/attachment-chips';
import { applyCommandToDraft, getComposerCommands } from '@/features/composer/composer-commands';
import { composerSubmission } from '@/features/composer/composer-submission';
import { getComposerDraft, saveComposerDraft } from '@/features/composer/draft-store';
import { FamilySwitchConfirmDialog } from '@/features/composer/family-switch-confirm-dialog';
import { ModeChip } from '@/features/composer/mode-chip';
import { ModelPicker } from '@/features/composer/model-picker';
import { NoticeTab, type ComposerNotice } from '@/features/composer/notice-tab';
import { SendButton, StartButton, StopButton } from '@/features/composer/submit-button';
import { useAddCredits } from '@/features/composer/use-add-credits';
import { useCommandSheet } from '@/features/composer/use-command-sheet';
import { useComposerHandle, type ComposerHandle } from '@/features/composer/use-composer-handle';
import { useDraftAttachments } from '@/features/composer/use-draft-attachments';
import { useModelAccess } from '@/features/composer/use-model-access';
import { useModelSwitch } from '@/features/composer/use-model-switch';
import { AiCreditsPurchaseDialog } from '@/features/credits';
import { useSubmitFeedback } from '@/lib/hooks';
import { PlusIcon, StartSiteIcon } from '@/lib/icons';
import { isImeComposing } from '@/lib/keyboard';
import {
	DropOverlay,
	Button,
	CommandSheet,
	handleCommandKey,
	InputGroup,
	InputGroupTextarea,
	Popover,
} from '@/lib/ui';
import styles from './style.module.css';
import type { AiModelId, SessionEntry, StudioVisualAnnotationSummary } from '@/data/core';
import type { ComposerAttachment, ComposerSendAttachments } from '@/data/use-composer-attachments';

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
	draftKey?: string;
	provider?: ProviderId;
	entries?: SessionEntry[];
	// The local site the session belongs to; a confirmed family switch opens
	// the fresh session under it.
	ownerSiteId?: string;
	onSwitchSession?: ( sessionId: string ) => void;
	autoFocus?: boolean;
	// 'field': embedded in a form that submits the draft itself via
	// `getSubmission()` — no Send/Stop control, Enter inserts a newline.
	variant?: 'chat' | 'field';
	placeholder?: string;
	ariaLabel?: string;
	// The placeholder describes work in progress (e.g. the site starting).
	placeholderBusy?: boolean;
	// Offers the auto-start preference, for a chat on a local site.
	canAutoStart?: boolean;
	onStartSite?: () => void;
	onStopSite?: () => void;
	onAnnotate?: () => void;
	annotationDisabled?: boolean;
	siteActionDisabled?: boolean;
	isSiteStarting?: boolean;
	// The site the chat works on; a chat on the live site can switch back to local.
	environment?: 'local' | 'live';
	onEnvironmentChange?: ( environment: 'local' | 'live' ) => void;
	// Where files can be dropped; the composer itself when absent.
	dropTarget?: HTMLElement | null;
	// The site whose preview annotations go out with the next message.
	annotationSiteId?: string;
	onModelChange?: ( model: AiModelId, provider: ProviderId ) => void;
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
		draftKey = sessionId,
		provider,
		entries,
		ownerSiteId,
		onSwitchSession,
		autoFocus = false,
		variant = 'chat',
		placeholder: placeholderOverride,
		ariaLabel,
		placeholderBusy = false,
		canAutoStart = false,
		onStartSite,
		onStopSite,
		onAnnotate,
		annotationDisabled = false,
		siteActionDisabled = false,
		isSiteStarting = false,
		environment = 'local',
		onEnvironmentChange,
		dropTarget,
		annotationSiteId,
		onModelChange,
		notice: blockingNotice,
	},
	ref
) {
	const isField = variant === 'field';
	const panelCommand = usePanelCommand( isField ? undefined : ownerSiteId );
	const siteCommand =
		isField || environment === 'live'
			? undefined
			: onStopSite
			? 'stop'
			: onStartSite
			? 'start'
			: undefined;
	const [ initialDraft ] = useState( () => getComposerDraft( draftKey ) );
	const [ value, setValue ] = useState( initialDraft.text );
	const [ sending, setSending ] = useState( false );
	const [ validationError, setValidationError ] = useState< {
		message: string;
		value: string;
		model: AiModelId;
		attachments: ComposerAttachment[];
		notes: PreviewAnnotation[];
	} | null >( null );
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

	const { sessionProvider, providers, isModelLocked } = useModelAccess( {
		sessionId,
		entries,
		provider,
	} );
	const isWpcom = sessionProvider === 'wpcom';
	const isOutOfCredits = useIsOutOfAiCredits() && isWpcom;
	const { openAddCredits, purchase, closePurchase } = useAddCredits();
	const blockingComposerNotice =
		blockingNotice ??
		( isOutOfCredits
			? {
					message: __( 'Add AI credits to send another message.' ),
					action: { label: __( 'Add credits' ), onClick: () => openAddCredits() },
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
			panelCommand,
			siteCommand,
			canAnnotate: ! isField && !! onAnnotate,
			autoStartOn,
			canChooseModel: ! busy && providers.length > 0,
			environment,
			canChangeEnvironment: !! onEnvironmentChange,
		} ),
		isDisabled: ( name ) =>
			( name === siteCommand && siteActionDisabled ) ||
			( name === 'annotate' && !! onAnnotate && ( annotationDisabled || siteActionDisabled ) ) ||
			( name === 'auto-start' && ( ! preferences || savePreferences.isPending ) ) ||
			( ( name === 'live' || name === 'local' ) && busy ),
	} );

	// Replaces the `/fragment` before the cursor: a skill lands as `/name`, an
	// action runs and leaves the draft without its fragment.
	const runCommand = ( name: string ) => {
		sheet.close();
		const start = textareaRef.current?.selectionStart ?? value.length;
		const end = textareaRef.current?.selectionEnd ?? start;
		const isSkill = sheet.skills.some( ( skill ) => skill.name === name );
		const draft = applyCommandToDraft( value, start, end, name, isSkill );
		if ( ! isSkill ) {
			if ( name === 'add-files' ) {
				fileInputRef.current?.click();
			} else if ( name === 'start' ) {
				onStartSite?.();
			} else if ( name === 'stop' ) {
				onStopSite?.();
			} else if ( name === 'annotate' ) {
				onAnnotate?.();
			} else if ( name === 'model' ) {
				pendingCommandRef.current = () => setModelOpen( true );
			} else if ( name === 'connect-provider' ) {
				openSettings( 'ai' );
			} else if ( name === 'local' ) {
				onEnvironmentChange?.( name );
			} else if ( name === 'panel' ) {
				panelCommand?.run();
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
		attachmentError,
		attachments,
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
		siteId: isField ? undefined : ownerSiteId,
		annotationSiteId,
		dropTarget: fileDropTarget,
		textareaRef,
	} );
	const hasAttachments = attachments.length > 0;
	const currentValidationError =
		validationError?.value === value &&
		validationError.model === model &&
		validationError.attachments === attachments &&
		validationError.notes === stagedNotes
			? validationError.message
			: null;
	const notice =
		blockingComposerNotice ??
		( attachmentError || currentValidationError
			? { message: attachmentError || currentValidationError! }
			: undefined );

	useEffect( () => {
		if ( draftEffectInitializedRef.current ) {
			saveComposerDraft( draftKey, { text: value, attachments } );
		} else {
			draftEffectInitializedRef.current = true;
		}
	}, [ attachments, draftKey, value ] );

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
			setValidationError( {
				message: ( error as Error ).message.replace( /\.$/, '' ),
				value,
				model,
				attachments,
				notes: stagedNotes,
			} );
			return;
		}
		if (
			submission.options.images?.length &&
			getAiModel( sessionProvider, model )?.supportsImages === false
		) {
			setValidationError( {
				message: __( 'Choose a model that supports images before sending these attachments' ),
				value,
				model,
				attachments,
				notes: stagedNotes,
			} );
			return;
		}
		// Cleared up front so a composer remounted before the send is accepted
		// doesn't bring the sent draft back; a failed send restores it.
		setValidationError( null );
		setValue( '' );
		restoreAttachments( [] );
		setSending( true );
		try {
			await onSend( submission.prompt, submission.options );
		} catch {
			// The parent reports the failure in a toast. Keep the draft even if
			// its site was closed while the request was pending.
			const currentDraft = getComposerDraft( draftKey );
			saveComposerDraft( draftKey, {
				text: currentDraft.text || value,
				attachments: [ ...attachments, ...currentDraft.attachments ],
			} );
			setValue( ( current ) => current || value );
			restoreAttachments( ( current ) => [ ...attachments, ...current ] );
			return;
		} finally {
			setSending( false );
		}
		if ( annotationSiteId && sentNotes.length ) {
			removeAnnotations(
				annotationSiteId,
				sentNotes.map( ( note ) => note.id )
			);
		}
	}, [
		value,
		draftKey,
		sending,
		attachments,
		busy,
		blockingNotice,
		isOutOfCredits,
		shake,
		answerQuestion,
		onSend,
		restoreAttachments,
		annotationSiteId,
		model,
		sessionProvider,
		stagedNotes,
	] );

	useComposerHandle( ref, {
		value,
		setValue,
		attachments,
		restoreAttachments,
		textareaRef,
		send,
	} );

	const focusTextareaFromShell = useCallback( ( event: MouseEvent< HTMLDivElement > ) => {
		if ( ! shouldShellFocusTextarea( event.target ) ) {
			return;
		}
		event.preventDefault();
		textareaRef.current?.focus();
	}, [] );

	const showStop = ! isField && busy && ( sending || ! hasContent );
	const showStart = ! busy && ! sending && ! hasContent && !! onStartSite;
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
	const addButton = (
		<Button variant="ghost" size="icon" shape="round" aria-label={ __( 'Add' ) }>
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
					className={ styles.shell }
					onMouseDown={ focusTextareaFromShell }
				>
					{ isDraggingFiles && fileDropTarget
						? createPortal( <DropOverlay>{ __( 'Drop to attach' ) }</DropOverlay>, fileDropTarget )
						: null }
					{ shownAttachments.length ? (
						<AttachmentChips
							attachments={ shownAttachments }
							annotationsAttachment={ annotationsAttachment }
							annotationSiteId={ annotationSiteId }
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
								ariaLabel ??
								( answerQuestion
									? __( 'Answer WordPress Studio' )
									: __( 'Message WordPress Studio' ) )
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
								if ( event.key === 'Enter' && sheet.open ) {
									event.preventDefault();
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
							<Popover.Trigger render={ addButton } />
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
							) : showStart ? (
								<StartButton
									disabled={ siteActionDisabled }
									isStarting={ isSiteStarting }
									onStart={ onStartSite }
								/>
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
			{ purchase ? (
				<AiCreditsPurchaseDialog
					open
					onOpenChange={ closePurchase }
					finalFocus={ purchase.returnFocus }
				/>
			) : null }
		</Popover.Root>
	);
} );

export const Composer = forwardRef< ComposerHandle, ComposerProps >(
	function Composer( props, ref ) {
		return <ComposerContent key={ props.draftKey ?? props.sessionId } { ...props } ref={ ref } />;
	}
);
