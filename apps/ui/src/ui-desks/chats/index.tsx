import { Dialog } from '@base-ui/react/dialog';
import { createDefaultDeskSettings } from '@studio/common/lib/desk-settings';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useMemo } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useDeskSettings } from '@/data/queries/use-desk-config';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { ActionButton, List, ListItem } from '@/ui-desks/components';
import { ChatsButton } from '../chrome/chats-button';
import { getDeskToolbarButtonSide, normalizeDeskToolbarSettings } from '../chrome/toolbar-layout';
import { useChats } from './context';
import { SessionSurface } from './session-surface';
import styles from './style.module.css';
import { useChatPanelResize } from './use-chat-panel-resize';
import type { AiSessionSummary } from '@/data/core';
import type { CSSProperties } from 'react';

export { ChatsProvider } from './provider';

interface ChatsProps {
	siteId?: string;
}

function getSessionTitle( session: AiSessionSummary ) {
	return session.firstPrompt?.trim() || __( 'New chat' );
}

function getSessionSubtitle( session: AiSessionSummary ) {
	if ( ! session.firstPrompt ) {
		return __( 'Ask Studio anything to get started.' );
	}

	return formatRelativeTime( session.updatedAt );
}

export function ChatsTrigger() {
	const { open, setOpen } = useChats();

	return <ChatsButton open={ open } onToggle={ () => setOpen( ! open ) } />;
}

export function Chats( { siteId }: ChatsProps ) {
	const {
		open,
		setOpen,
		selectedSessionId,
		expanded,
		autoFocusSessionId,
		isCreatingChat,
		pendingPrompt,
		selectSession,
		switchSession,
		clearSelection,
		startNewChat,
		consumePendingPrompt,
	} = useChats();
	const { data: savedDeskSettings } = useDeskSettings();
	const { data: sessions, isFetching: isFetchingSessions } = useSessions();
	const { data: sites } = useSites();
	const isFullscreen = useFullscreen();
	const fallbackDeskSettings = useMemo( () => createDefaultDeskSettings(), [] );
	const deskSettings = useMemo(
		() => normalizeDeskToolbarSettings( savedDeskSettings ?? fallbackDeskSettings ),
		[ fallbackDeskSettings, savedDeskSettings ]
	);
	const side = getDeskToolbarButtonSide( deskSettings.toolbarLayout, 'chat' );
	const { width, isResizing, listCollapsed, collapseList, expandList, startResize } =
		useChatPanelResize( side );
	const site = siteId ? sites?.find( ( candidate ) => candidate.id === siteId ) : undefined;
	const filteredSessions = siteId
		? site?.path
			? ( sessions ?? [] ).filter(
					( session ) => session.ownerSitePath === site.path && ! session.archived
			  )
			: []
		: ( sessions ?? [] ).filter( ( session ) => ! session.ownerSitePath && ! session.archived );
	const chatSessions = [ ...filteredSessions ].sort(
		( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
	);
	const selectedSession = chatSessions.find( ( session ) => session.id === selectedSessionId );
	const isListCollapsed = expanded && listCollapsed;

	useEffect( () => {
		if ( selectedSessionId && sessions && ! isFetchingSessions && ! selectedSession ) {
			clearSelection();
		}
	}, [ clearSelection, isFetchingSessions, selectedSession, selectedSessionId, sessions ] );

	return (
		<Dialog.Root open={ open } onOpenChange={ setOpen } modal={ false } disablePointerDismissal>
			<Dialog.Portal>
				<Dialog.Popup
					initialFocus={ false }
					finalFocus={ false }
					className={ clsx(
						styles.panel,
						isFullscreen && styles.panelFullscreen,
						motionStyles.motion,
						expanded && styles.panelExpanded
					) }
					data-side={ side }
					data-expanded={ expanded ? 'true' : 'false' }
					data-list-collapsed={ isListCollapsed ? 'true' : 'false' }
					data-resizing={ isResizing ? 'true' : 'false' }
					style={
						expanded
							? ( {
									'--desk-chats-panel-width': `${ width }px`,
							  } as CSSProperties )
							: undefined
					}
					aria-label={ __( 'Conversations' ) }
				>
					{ ! isListCollapsed ? (
						<div className={ styles.listPane }>
							<header className={ styles.header }>
								<h2>{ __( 'Conversations' ) }</h2>
							</header>
							<List className={ styles.list }>
								{ chatSessions.map( ( session ) => (
									<ListItem
										key={ session.id }
										active={ session.id === selectedSessionId }
										label={ getSessionTitle( session ) }
										description={ getSessionSubtitle( session ) }
										onClick={ () => selectSession( session.id ) }
									/>
								) ) }
							</List>
							<footer className={ styles.footer }>
								<ActionButton
									fullWidth
									disabled={ isCreatingChat }
									aria-busy={ isCreatingChat }
									onClick={ () => void startNewChat() }
								>
									{ isCreatingChat ? __( 'Creating chat…' ) : __( '+ New chat' ) }
								</ActionButton>
							</footer>
							<div className={ styles.listDivider } aria-hidden />
						</div>
					) : null }
					{ expanded ? (
						<div className={ styles.chatPane }>
							{ selectedSessionId ? (
								<SessionSurface
									key={ selectedSessionId }
									siteId={ siteId }
									sessionId={ selectedSessionId }
									side={ side }
									listCollapsed={ isListCollapsed }
									onExpandList={ expandList }
									onCollapseList={ collapseList }
									onSwitchSession={ switchSession }
									autoFocus={ autoFocusSessionId === selectedSessionId }
									initialPrompt={
										pendingPrompt?.sessionId === selectedSessionId ? pendingPrompt : undefined
									}
									onInitialPromptConsumed={ consumePendingPrompt }
								/>
							) : (
								<div className={ styles.emptyChat }>
									{ __( 'Ask Studio anything to get started.' ) }
								</div>
							) }
						</div>
					) : null }
					<div
						className={ styles.resizeHandle }
						onPointerDown={ startResize }
						role="separator"
						aria-orientation="vertical"
						aria-label={ __( 'Resize conversations' ) }
						aria-hidden={ ! expanded }
					/>
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
