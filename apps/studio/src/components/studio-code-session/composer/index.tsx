import { AI_MODELS, getAiModelFamily, getAiModelLabel } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { useQueryClient } from '@tanstack/react-query';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { arrowUp, chevronDownSmall } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { useCallback, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import * as Menu from '../menu';
import { SESSIONS_QUERY_KEY } from '../use-session';
import { FamilySwitchConfirmDialog } from './family-switch-confirm-dialog';
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
}: ComposerProps ) {
	const [ value, setValue ] = useState( '' );
	const queryClient = useQueryClient();

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
					<textarea
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
