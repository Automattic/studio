import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { EnvironmentPill } from './environment-pill';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
import styles from './style.module.css';
import type { AiModelId, LoadedAiSession, SessionEntryBase, SyncSite } from '@/data/core';

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
	onSend: ( prompt: string ) => Promise< void >;
	onInterrupt: () => Promise< void >;
	// Environment pill: only rendered when both a `sessionId` and a linked
	// `liveSite` are available. Without a live link the pill is hidden
	// entirely (there'd be nothing to flip to).
	sessionId?: string;
	effectiveEnvironment?: 'local' | 'live';
	liveSite?: SyncSite;
	entries?: SessionEntryBase[];
	// Local owner site id, when the session is anchored to one. Required to
	// spin up a fresh session via `connector.createSession` on a confirmed
	// family swap; if absent we fall back to the in-place model change so the
	// dropdown still works for unowned sessions.
	ownerSiteId?: string;
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

const isMacPlatform =
	typeof navigator !== 'undefined' && /mac/i.test( navigator.platform || navigator.userAgent );

export const Composer = forwardRef< ComposerHandle, ComposerProps >( function Composer(
	{
		busy,
		isInterrupting = false,
		error,
		model,
		onSend,
		onInterrupt,
		sessionId,
		effectiveEnvironment = 'local',
		liveSite,
		entries,
		ownerSiteId,
	},
	ref
) {
	const [ value, setValue ] = useState( '' );
	const textareaRef = useRef< HTMLTextAreaElement | null >( null );
	const connector = useConnector();
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	// Cross-family swap state. We hold the picked model here while the
	// confirmation dialog is open; nothing is persisted until the user
	// confirms.
	const [ pendingFamilyChange, setPendingFamilyChange ] = useState< AiModelId | null >( null );
	const [ familySwitchInFlight, setFamilySwitchInFlight ] = useState( false );

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
									...prev.entries,
									{
										type: 'model_change',
										id: Math.random().toString( 36 ).slice( 2, 10 ),
										parentId: null,
										timestamp,
										provider: '',
										modelId: picked,
									} as unknown as SessionEntryBase,
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
			// Cross-family switch: defer until the user confirms in the dialog
			// — the runtimes don't share a transcript, so continuing the same
			// JSONL across families would make the on-screen history disagree
			// with the agent's actual memory. We skip the prompt when:
			//   - the session has no user turns yet (nothing to lose), or
			//   - the session has no local owner site (we have no `siteId` to
			//     pass to `createSession`, so the fresh-session path can't
			//     run; fall back to the in-place switch instead of blocking
			//     the dropdown).
			const hasTurns = ( entries ?? [] ).some( ( entry ) =>
				isStudioCustomEntryOfType( entry, 'studio.user_prompt' )
			);
			if ( getAiModelFamily( model ) !== getAiModelFamily( picked ) && ownerSiteId && hasTurns ) {
				setPendingFamilyChange( picked );
				return;
			}
			applySameFamilyModel( picked );
		},
		[ applySameFamilyModel, entries, model, ownerSiteId ]
	);

	const cancelFamilyChange = useCallback( () => {
		if ( familySwitchInFlight ) {
			return;
		}
		setPendingFamilyChange( null );
	}, [ familySwitchInFlight ] );

	const confirmFamilyChange = useCallback( async () => {
		if ( ! pendingFamilyChange || ! ownerSiteId ) {
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
			void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			setPendingFamilyChange( null );
			void navigate( { to: '/sessions/$sessionId', params: { sessionId: newSession.id } } );
		} finally {
			setFamilySwitchInFlight( false );
		}
	}, [ connector, navigate, ownerSiteId, pendingFamilyChange, queryClient ] );

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
					<textarea
						ref={ textareaRef }
						className={ styles.input }
						placeholder={ placeholder }
						value={ value }
						onChange={ ( event ) => setValue( event.target.value ) }
						onKeyDown={ ( event ) => {
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
					<div className={ styles.toolbar }>
						<div className={ styles.leftActions }>
							<Menu.Root modal={ false }>
								<Menu.Trigger
									render={
										<button
											type="button"
											className={ `${ styles.iconButton } ${ styles.glyphButton }` }
											aria-label={ __( 'Commands' ) }
										>
											/
										</button>
									}
								/>
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
						{ modKey }↩ { __( 'to send' ) } · shift↩ { __( 'for newline' ) }
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
} );
