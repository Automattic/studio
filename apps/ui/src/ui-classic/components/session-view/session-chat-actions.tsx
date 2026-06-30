import { __, sprintf } from '@wordpress/i18n';
import { backup } from '@wordpress/icons';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { Button, Icon, Tooltip } from '@wordpress/ui';
import { useEffect } from 'react';
import * as Menu from '@/components/menu';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { formatRelativeTime } from '@/lib/format-relative-time';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';

const NEW_CHAT_SHORTCUT_KEY = 'n';
const NEW_CHAT_SHORTCUT = {
	displayShortcut: displayShortcut.primary( NEW_CHAT_SHORTCUT_KEY ),
	ariaKeyShortcut: ariaKeyShortcut.primary( NEW_CHAT_SHORTCUT_KEY ),
};

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
}: {
	currentSession: AiSessionSummary;
	ownerSitePath: string | undefined;
	sessions: AiSessionSummary[] | undefined;
} ): AiSessionSummary[] {
	if ( ! ownerSitePath ) {
		return [];
	}

	const sessionsById = new Map< string, AiSessionSummary >();
	for ( const session of sessions ?? [] ) {
		if ( session.archived || session.ownerSitePath !== ownerSitePath ) {
			continue;
		}
		sessionsById.set( session.id, session );
	}

	if ( ! currentSession.archived && currentSession.ownerSitePath === ownerSitePath ) {
		sessionsById.set( currentSession.id, currentSession );
	}

	return [ ...sessionsById.values() ].sort( ( a, b ) => getTimestamp( b ) - getTimestamp( a ) );
}

interface SessionChatActionsProps {
	currentSessionId: string;
	isCreatingSession?: boolean;
	onNewChat: () => void;
	onSwitchSession: ( sessionId: string ) => void;
	sessions: AiSessionSummary[];
}

export function SessionChatActions( {
	currentSessionId,
	isCreatingSession = false,
	onNewChat,
	onSwitchSession,
	sessions,
}: SessionChatActionsProps ) {
	const sidebarCollapsed = useSidebarCollapsed();

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
		<div
			className={
				sidebarCollapsed
					? `${ styles.classicComposerFooter } ${ styles.classicComposerFooterSidebarCollapsed }`
					: styles.classicComposerFooter
			}
		>
			<div className={ styles.classicComposerFooterSide }>
				<Menu.Root modal={ false }>
					<Tooltip.Provider delay={ 0 }>
						<Tooltip.Root>
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
					</Tooltip.Provider>
					<Menu.Popup side="top" align="end" className={ styles.classicComposerHistoryMenu }>
						{ sessions.length > 0 ? (
							sessions.map( ( session ) => {
								const isCurrent = session.id === currentSessionId;
								const updatedAt = formatRelativeTime( session.updatedAt );
								return (
									<Menu.Item
										key={ session.id }
										className={ styles.classicComposerHistoryItem }
										data-current={ isCurrent ? 'true' : undefined }
										aria-current={ isCurrent ? 'page' : undefined }
										onClick={ () => {
											if ( ! isCurrent ) {
												onSwitchSession( session.id );
											}
										} }
									>
										<span className={ styles.classicComposerHistoryTitle }>
											{ getSessionTitle( session ) }
										</span>
										{ updatedAt ? (
											<span className={ styles.classicComposerHistoryMeta }>{ updatedAt }</span>
										) : null }
									</Menu.Item>
								);
							} )
						) : (
							<div className={ styles.classicComposerHistoryEmpty }>{ __( 'No chats yet' ) }</div>
						) }
					</Menu.Popup>
				</Menu.Root>
				<Tooltip.Provider delay={ 0 }>
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
									aria-keyshortcuts={ NEW_CHAT_SHORTCUT.ariaKeyShortcut }
								/>
							}
						>
							<span>{ isCreatingSession ? __( 'Starting new chat' ) : __( 'New chat' ) }</span>
						</Tooltip.Trigger>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="top" /> }>
							{ sprintf(
								// translators: %s: keyboard shortcut for starting a new chat.
								__( 'New chat %s' ),
								NEW_CHAT_SHORTCUT.displayShortcut
							) }
						</Tooltip.Popup>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>
		</div>
	);
}

export function SessionChatActionsSkeleton() {
	const sidebarCollapsed = useSidebarCollapsed();

	return (
		<div
			className={
				sidebarCollapsed
					? `${ styles.classicComposerFooter } ${ styles.classicComposerFooterSidebarCollapsed }`
					: styles.classicComposerFooter
			}
			style={ { visibility: 'hidden' } }
			aria-hidden="true"
		>
			<div className={ styles.classicComposerFooterSide }>
				<Button
					type="button"
					variant="minimal"
					tone="neutral"
					size="small"
					className={ `${ styles.classicComposerTextButton } ${ styles.classicComposerIconButton }` }
					aria-label={ __( 'Chat history' ) }
					tabIndex={ -1 }
				>
					<Icon icon={ backup } size={ 26 } className={ styles.classicComposerIcon } />
				</Button>
				<Button
					type="button"
					className={ styles.classicComposerTextButton }
					variant="minimal"
					tone="neutral"
					size="small"
					tabIndex={ -1 }
				>
					<span>{ __( 'New chat' ) }</span>
				</Button>
			</div>
		</div>
	);
}
