import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { useQueryClient } from '@tanstack/react-query';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import motionStyles from '../floating-surface-motion/style.module.css';
import * as Menu from '../menu';
import menuStyles from '../menu/style.module.css';
import { SESSIONS_QUERY_KEY } from '../use-session';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import { getSlashCommandMatches } from './slash-autocomplete';
import styles from './style.module.css';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
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
	model: AiModelId;
	onSend: ( prompt: string ) => Promise< void >;
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

export function Composer( {
	busy,
	isInterrupting = false,
	error,
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
	const [ value, setValue ] = useState( '' );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const appliedDraftPromptIdRef = useRef< number | null >( null );
	const queryClient = useQueryClient();

	useEffect( () => {
		if ( ! draftPrompt || appliedDraftPromptIdRef.current === draftPrompt.id ) {
			return;
		}
		appliedDraftPromptIdRef.current = draftPrompt.id;
		setValue( draftPrompt.prompt );
		queueMicrotask( () => {
			const node = textareaRef.current;
			if ( ! node ) {
				return;
			}
			node.focus();
			const length = node.value.length;
			node.setSelectionRange( length, length );
		} );
	}, [ draftPrompt ] );

	// Inline slash-command autocomplete. The popup is driven entirely by the
	// textarea value so the textarea keeps focus the whole time (a `Menu.Root`
	// would steal focus). The helper closes the popup while a `previewPrompt`
	// is active so it never collides with the example-prompt preview.
	const { open: slashOpen, matches: slashMatches } = useMemo(
		() => getSlashCommandMatches( value, previewPrompt ),
		[ value, previewPrompt ]
	);
	const [ highlightedIndex, setHighlightedIndex ] = useState( 0 );

	// Whenever the filtered list changes, reset the highlight to the top.
	const matchKey = slashMatches.map( ( command ) => command.name ).join( ',' );
	useEffect( () => {
		setHighlightedIndex( 0 );
	}, [ matchKey ] );

	// Accessibility: wire the textarea (combobox) to the listbox and its active
	// option so screen readers announce the open state and the highlighted item.
	const listboxId = useId();
	const optionId = useCallback( ( name: string ) => `${ listboxId }-${ name }`, [ listboxId ] );
	const activeOptionId =
		slashOpen && slashMatches[ highlightedIndex ]
			? optionId( slashMatches[ highlightedIndex ].name )
			: undefined;

	// Replace the trailing `/token` (at start or after whitespace) with the
	// chosen command, preserving any earlier text and the leading whitespace.
	const insertSlashCommand = useCallback( ( name: string ) => {
		setValue( ( prev ) => prev.replace( /(^|\s)\/[\w-]*$/, `$1/${ name } ` ) );
		textareaRef.current?.focus();
	}, [] );

	// Legend affordance below the input: appends a "/" (preceded by a space when
	// the input doesn't already end in whitespace) and focuses the textarea,
	// which opens the inline autocomplete. Keeps whatever the user already typed
	// so commands can be discovered mid-message, not just on an empty input.
	const triggerSlashCommands = useCallback( () => {
		setValue( ( prev ) => {
			if ( prev.length === 0 ) {
				return '/';
			}
			return /\s$/.test( prev ) ? `${ prev }/` : `${ prev } /`;
		} );
		const node = textareaRef.current;
		queueMicrotask( () => {
			if ( ! node ) {
				return;
			}
			node.focus();
			const end = node.value.length;
			node.setSelectionRange( end, end );
		} );
	}, [] );

	// Cross-family swap state. We hold the picked model here while the
	// confirmation dialog is open; nothing is persisted until the user
	// confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

	const send = useCallback( async () => {
		const trimmed = value.trim();
		if ( ! trimmed ) {
			return;
		}
		setValue( '' );
		try {
			await onSend( trimmed );
		} catch {
			// Restore the draft so the user can retry; the parent surfaces the
			// error message via `error`. Queued sends never throw from onSend
			// (the parent swallows the failure and clears the queue instead),
			// so this path only trips for direct sends from the idle state.
			setValue( trimmed );
		}
	}, [ value, onSend ] );

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

	const canSend = value.trim().length > 0;
	const placeholder = busy
		? __( 'Queue a follow-up instruction…' )
		: __( 'Set your next instruction…' );
	const sendAriaLabel = busy ? __( 'Queue' ) : __( 'Send' );
	const modKey = isMacPlatform ? '⌘' : 'Ctrl';

	return (
		<>
			<div className={ styles.root }>
				<div className={ styles.shell }>
					<div className={ styles.inputWrapper }>
						<textarea
							ref={ textareaRef }
							className={ styles.input }
							placeholder={ placeholder }
							value={ previewPrompt ?? value }
							data-preview={ previewPrompt ? 'true' : 'false' }
							role="combobox"
							aria-autocomplete="list"
							aria-haspopup="listbox"
							aria-expanded={ slashOpen }
							aria-controls={ slashOpen ? listboxId : undefined }
							aria-activedescendant={ activeOptionId }
							onChange={ ( event ) => setValue( event.target.value ) }
							onKeyDown={ ( event ) => {
								if ( slashOpen ) {
									if ( event.key === 'ArrowDown' ) {
										event.preventDefault();
										setHighlightedIndex( ( index ) => ( index + 1 ) % slashMatches.length );
										return;
									}
									if ( event.key === 'ArrowUp' ) {
										event.preventDefault();
										setHighlightedIndex(
											( index ) => ( index - 1 + slashMatches.length ) % slashMatches.length
										);
										return;
									}
									if ( event.key === 'Enter' || event.key === 'Tab' ) {
										event.preventDefault();
										const command = slashMatches[ highlightedIndex ];
										if ( command ) {
											insertSlashCommand( command.name );
										}
										return;
									}
									if ( event.key === 'Escape' ) {
										// Close the popup by dropping the unfinished `/token`, leaving any
										// earlier text intact. stopPropagation keeps this Escape from also
										// reaching the Escape-to-interrupt handler.
										event.preventDefault();
										event.stopPropagation();
										setValue( ( prev ) => prev.replace( /(^|\s)\/[\w-]*$/, '' ) );
										return;
									}
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
						{ slashOpen ? (
							<ul
								id={ listboxId }
								className={ `${ menuStyles.popup } ${ styles.autocompletePopup } ${ motionStyles.motion }` }
								data-side="top"
								data-align="start"
								role="listbox"
								aria-label={ __( 'Slash commands' ) }
							>
								{ slashMatches.map( ( command, index ) => (
									<li
										key={ command.name }
										id={ optionId( command.name ) }
										role="option"
										aria-selected={ index === highlightedIndex }
										className={ menuStyles.item }
										data-highlighted={ index === highlightedIndex ? '' : undefined }
										onMouseDown={ ( event ) => {
											// Prevent the textarea from losing focus on click.
											event.preventDefault();
											insertSlashCommand( command.name );
										} }
										onMouseEnter={ () => setHighlightedIndex( index ) }
									>
										<span className={ styles.commandItem }>
											<span className={ styles.commandName }>/{ command.name }</span>
											<span className={ styles.commandDescription }>{ command.description }</span>
										</span>
									</li>
								) ) }
							</ul>
						) : null }
					</div>
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<button
								type="button"
								className={ `${ styles.iconButton } ${ styles.glyphButton }` }
								aria-label={ __( 'Skills' ) }
								onClick={ triggerSlashCommands }
							>
								/
							</button>
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
					{ error ? <span className={ styles.error }>{ error }</span> : null }
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
