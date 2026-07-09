import { __, sprintf } from '@wordpress/i18n';
import { backup, box } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Dialog, Icon, IconButton, Tooltip } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import * as Menu from '@/components/menu';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

const NEW_CHAT_SHORTCUT_KEY = 'n';

function getTimestamp( session: AiSessionSummary ): number {
	return Date.parse( session.updatedAt ) || 0;
}

function getSessionTitle( session: AiSessionSummary ): string {
	return session.firstPrompt?.trim() || __( 'Untitled chat' );
}

export function getSiteSessionHistory( {
	currentSession,
	ownerSitePath,
	sessions,
	archived = false,
}: {
	currentSession: AiSessionSummary;
	ownerSitePath: string | undefined;
	sessions: AiSessionSummary[] | undefined;
	archived?: boolean;
} ): AiSessionSummary[] {
	if ( ! ownerSitePath ) {
		return [];
	}

	// The current session comes from a separate query and may be fresher than
	// its copy in the list, so it goes last and wins the Map dedupe.
	const sessionsById = new Map< string, AiSessionSummary >();
	for ( const session of [ ...( sessions ?? [] ), currentSession ] ) {
		if ( !! session.archived === archived && session.ownerSitePath === ownerSitePath ) {
			sessionsById.set( session.id, session );
		}
	}

	return [ ...sessionsById.values() ].sort( ( a, b ) => getTimestamp( b ) - getTimestamp( a ) );
}

interface SessionChatActionsProps {
	archivedSessions?: AiSessionSummary[];
	currentSessionId: string;
	isCreatingSession?: boolean;
	onNewChat: () => void;
	onSwitchSession: ( sessionId: string ) => void;
	sessions: AiSessionSummary[];
}

export function SessionChatActions( {
	archivedSessions = [],
	currentSessionId,
	isCreatingSession = false,
	onNewChat,
	onSwitchSession,
	sessions,
}: SessionChatActionsProps ) {
	const updateSessionMetadata = useUpdateSessionMetadata();
	const [ archiveDialogOpen, setArchiveDialogOpen ] = useState( false );
	const [ historyMenuOpen, setHistoryMenuOpen ] = useState( false );

	const archiveSession = ( session: AiSessionSummary ) => {
		updateSessionMetadata.mutate( {
			sessionId: session.id,
			patch: {
				starred: session.starred,
				archived: true,
			},
		} );
	};

	useEffect( () => {
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if (
				event.defaultPrevented ||
				event.repeat ||
				isCreatingSession ||
				! isKeyboardEvent.primary( event, NEW_CHAT_SHORTCUT_KEY )
			) {
				return;
			}

			event.preventDefault();
			onNewChat();
		};

		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ isCreatingSession, onNewChat ] );

	return (
		<div className={ styles.classicComposerFooter }>
			<div className={ styles.classicComposerFooterSide }>
				<Menu.Root modal={ false } onOpenChange={ setHistoryMenuOpen }>
					<Tooltip.Root disabled={ historyMenuOpen }>
						<Menu.Trigger
							render={
								<Tooltip.Trigger
									render={
										<Button
											type="button"
											variant="minimal"
											tone="neutral"
											size="small"
											className={ `${ styles.classicComposerTextButton } ${ styles.classicComposerIconButton }` }
											aria-label={ __( 'Chat history' ) }
										/>
									}
								>
									<Icon icon={ backup } size={ 26 } className={ styles.classicComposerIcon } />
								</Tooltip.Trigger>
							}
						/>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
							{ __( 'Chat history' ) }
						</Tooltip.Popup>
					</Tooltip.Root>
					<Menu.Popup side="top" align="end" className={ styles.classicComposerHistoryMenu }>
						{ sessions.length > 0 ? (
							sessions.map( ( session ) => {
								const isCurrent = session.id === currentSessionId;
								const updatedAt = formatRelativeTime( session.updatedAt );
								const title = getSessionTitle( session );
								return (
									<Menu.Item
										key={ session.id }
										className={ styles.classicComposerHistoryItem }
										aria-current={ isCurrent ? 'page' : undefined }
										onClick={ () => {
											if ( ! isCurrent ) {
												onSwitchSession( session.id );
											}
										} }
									>
										<span className={ styles.classicComposerHistoryTitle }>{ title }</span>
										{ updatedAt ? (
											<span className={ styles.classicComposerHistoryTrailing }>
												<span className={ styles.classicComposerHistoryMeta }>{ updatedAt }</span>
												<IconButton
													type="button"
													className={ styles.classicComposerHistoryArchiveButton }
													variant="minimal"
													tone="neutral"
													size="small"
													icon={ box }
													label={ __( 'Archive chat' ) }
													onClick={ ( event ) => {
														event.preventDefault();
														event.stopPropagation();
														archiveSession( session );
													} }
												/>
											</span>
										) : null }
									</Menu.Item>
								);
							} )
						) : (
							<div className={ styles.classicComposerHistoryEmpty }>{ __( 'No chats yet' ) }</div>
						) }
						{ archivedSessions.length > 0 ? (
							<>
								<Menu.Separator className={ styles.classicComposerHistorySeparator } />
								<Menu.Item onClick={ () => setArchiveDialogOpen( true ) }>
									<span className={ styles.classicComposerHistoryTitle }>
										{ __( 'Archived chats' ) }
									</span>
									<span className={ styles.classicComposerHistoryMeta }>
										{ archivedSessions.length }
									</span>
								</Menu.Item>
							</>
						) : null }
					</Menu.Popup>
				</Menu.Root>
				<Dialog.Root open={ archiveDialogOpen } onOpenChange={ setArchiveDialogOpen }>
					<Dialog.Popup size="small" initialFocus={ false }>
						<Dialog.Header>
							<Dialog.Title>{ __( 'Archived chats' ) }</Dialog.Title>
						</Dialog.Header>
						<Dialog.Content>
							<div className={ styles.classicComposerArchiveList }>
								{ archivedSessions.length > 0 ? (
									archivedSessions.map( ( session ) => {
										const updatedAt = formatRelativeTime( session.updatedAt );
										return (
											<button
												key={ session.id }
												type="button"
												className={ styles.classicComposerArchiveItem }
												onClick={ () => {
													setArchiveDialogOpen( false );
													onSwitchSession( session.id );
												} }
											>
												<span className={ styles.classicComposerHistoryTitle }>
													{ getSessionTitle( session ) }
												</span>
												{ updatedAt ? (
													<span className={ styles.classicComposerHistoryMeta }>{ updatedAt }</span>
												) : null }
											</button>
										);
									} )
								) : (
									<div className={ styles.classicComposerHistoryEmpty }>
										{ __( 'No archived chats' ) }
									</div>
								) }
							</div>
						</Dialog.Content>
						<Dialog.Footer>
							<Dialog.Action variant="minimal" tone="neutral">
								{ __( 'Close' ) }
							</Dialog.Action>
						</Dialog.Footer>
					</Dialog.Popup>
				</Dialog.Root>
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								type="button"
								className={ styles.classicComposerTextButton }
								variant="minimal"
								tone="neutral"
								size="small"
								onClick={ onNewChat }
								disabled={ isCreatingSession }
								aria-busy={ isCreatingSession || undefined }
								aria-keyshortcuts={ ariaKeyShortcut.primary( NEW_CHAT_SHORTCUT_KEY ) }
							/>
						}
					>
						<span>{ isCreatingSession ? __( 'Starting new chat' ) : __( 'New chat' ) }</span>
					</Tooltip.Trigger>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
						{ sprintf(
							// translators: %s: keyboard shortcut for starting a new chat.
							__( 'New chat %s' ),
							displayShortcut.primary( NEW_CHAT_SHORTCUT_KEY )
						) }
					</Tooltip.Popup>
				</Tooltip.Root>
			</div>
		</div>
	);
}
