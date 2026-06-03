import { Dialog } from '@base-ui/react/dialog';
import { __ } from '@wordpress/i18n';
import { box, buttons, formatListBullets, plus } from '@wordpress/icons';
import { Icon } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import motionStyles from '@/components/floating-surface-motion/style.module.css';
import { useAuthUser, useLogin } from '@/data/queries/use-auth-user';
import { useSessions, useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { ChatsButton } from '@/ui-desks/chrome/chats-button';
import { Button } from '@/ui-desks/components';
import { useChats } from '../context';
import { SessionSurface } from '../session-surface';
import { WidgetContextThumbnailList } from '../widget-context';
import styles from './style.module.css';
import type { ChatPromptRequest } from '../context';
import type { ChatPanelResizeState, ChatPanelSide } from '../use-chat-panel-resize';
import type { AiSessionSummary } from '@/data/core';
import type { CSSProperties } from 'react';

interface ChatsProps {
	siteId?: string;
	side: ChatPanelSide;
	panel: ChatPanelResizeState;
}

const COMPACT_STORAGE_KEY = 'ui-desks-chat-list-compact';

function readStoredCompactPreference() {
	if ( typeof window === 'undefined' ) {
		return false;
	}

	return window.localStorage.getItem( COMPACT_STORAGE_KEY ) === '1';
}

function persistCompactPreference( compact: boolean ) {
	if ( typeof window === 'undefined' ) {
		return;
	}

	window.localStorage.setItem( COMPACT_STORAGE_KEY, compact ? '1' : '0' );
}

function getSessionTitle( session: AiSessionSummary ) {
	return session.title?.trim() || session.firstPrompt?.trim() || __( 'New chat' );
}

function getSessionSubtitle( session: AiSessionSummary ) {
	return (
		session.description ??
		session.assistantReplyPreview ??
		__( 'Ask Studio anything to get started.' )
	);
}

function formatSessionTimeSince( value: string ) {
	const timestamp = Date.parse( value );
	if ( Number.isNaN( timestamp ) ) {
		return '';
	}

	const seconds = Math.max( 0, Math.floor( ( Date.now() - timestamp ) / 1000 ) );
	if ( seconds < 60 ) {
		return __( 'now' );
	}

	const minutes = Math.floor( seconds / 60 );
	if ( minutes < 60 ) {
		return `${ minutes }m`;
	}

	const hours = Math.floor( minutes / 60 );
	if ( hours < 24 ) {
		return `${ hours }h`;
	}

	const days = Math.floor( hours / 24 );
	if ( days < 7 ) {
		return `${ days }d`;
	}

	const weeks = Math.floor( days / 7 );
	if ( weeks < 4 ) {
		return `${ weeks }w`;
	}

	const months = Math.floor( days / 30 );
	if ( months < 12 ) {
		return `${ months }mo`;
	}

	return `${ Math.floor( days / 365 ) }y`;
}

function ChatSessionRow( {
	session,
	active,
	metadataPending,
	onSelect,
	onArchiveChange,
}: {
	session: AiSessionSummary;
	active: boolean;
	metadataPending: boolean;
	onSelect: ( sessionId: string ) => void;
	onArchiveChange: ( session: AiSessionSummary, archived: boolean ) => void;
} ) {
	const archived = !! session.archived;

	return (
		<div className={ styles.sessionItem } data-active={ active ? 'true' : 'false' }>
			<button
				type="button"
				className={ styles.sessionSelectButton }
				onClick={ () => onSelect( session.id ) }
			>
				<span className={ styles.sessionItemRow }>
					<span className={ styles.sessionItemTitle }>{ getSessionTitle( session ) }</span>
					<span className={ styles.sessionItemMeta }>
						<span className={ styles.sessionItemTime }>
							{ formatSessionTimeSince( session.updatedAt || session.createdAt ) }
						</span>
					</span>
				</span>
				<span className={ styles.sessionItemPreview }>{ getSessionSubtitle( session ) }</span>
			</button>
			<button
				type="button"
				className={ styles.sessionItemArchive }
				aria-label={ archived ? __( 'Unarchive conversation' ) : __( 'Archive conversation' ) }
				title={ archived ? __( 'Unarchive' ) : __( 'Archive' ) }
				disabled={ metadataPending }
				onClick={ () => onArchiveChange( session, ! archived ) }
			>
				<Icon icon={ box } size={ 16 } />
			</button>
		</div>
	);
}

function EmptyChatState( {
	authRequiredPrompt,
	onContinuePrompt,
}: {
	authRequiredPrompt?: ChatPromptRequest;
	onContinuePrompt: ( request: ChatPromptRequest ) => Promise< string >;
} ) {
	const { data: authUser, isLoading: isLoadingAuthUser } = useAuthUser();
	const login = useLogin();

	if ( ! isLoadingAuthUser && ! authUser ) {
		return (
			<div className={ styles.emptyChat }>
				<div className={ styles.emptyChatContent }>
					<div className={ styles.emptyChatTitle }>{ __( 'Log in to use Studio Desk chat' ) }</div>
					<p>{ __( 'Studio Desk chat requires a WordPress.com account.' ) }</p>
					{ authRequiredPrompt ? (
						<div className={ styles.emptyChatDraft }>
							<span>{ __( 'Draft prompt' ) }</span>
							<p>{ authRequiredPrompt.displayMessage ?? authRequiredPrompt.prompt }</p>
						</div>
					) : null }
					<Button
						label={
							login.isPending
								? __( 'Opening WordPress.com login' )
								: __( 'Log in with WordPress.com' )
						}
						disabled={ login.isPending }
						aria-busy={ login.isPending }
						onClick={ () => login.mutate() }
						tone="primary"
						variant="filled"
					>
						{ login.isPending ? __( 'Opening login...' ) : __( 'Log in with WordPress.com' ) }
					</Button>
				</div>
			</div>
		);
	}

	if ( authUser && authRequiredPrompt ) {
		return (
			<div className={ styles.emptyChat }>
				<div className={ styles.emptyChatContent }>
					<div className={ styles.emptyChatTitle }>{ __( 'Ready to continue' ) }</div>
					<p>{ __( 'Your draft prompt is ready to send in a new chat.' ) }</p>
					<div className={ styles.emptyChatDraft }>
						<span>{ __( 'Draft prompt' ) }</span>
						<p>{ authRequiredPrompt.displayMessage ?? authRequiredPrompt.prompt }</p>
					</div>
					<Button
						label={ __( 'Continue with draft' ) }
						onClick={ () => void onContinuePrompt( authRequiredPrompt ) }
						tone="primary"
						variant="filled"
					>
						{ __( 'Continue with draft' ) }
					</Button>
				</div>
			</div>
		);
	}

	return <div className={ styles.emptyChat }>{ __( 'Ask Studio anything to get started.' ) }</div>;
}

export function ChatsTrigger() {
	const { open, setOpen } = useChats();

	return <ChatsButton open={ open } onToggle={ () => setOpen( ! open ) } />;
}

export function Chats( { siteId, side, panel }: ChatsProps ) {
	const {
		open,
		setOpen,
		selectedSessionId,
		expanded,
		autoFocusSessionId,
		isCreatingChat,
		pendingPrompt,
		authRequiredPrompt,
		composerWidgetDragPreview,
		selectSession,
		switchSession,
		clearSelection,
		startNewChat,
		startChatWithPrompt,
		consumePendingPrompt,
	} = useChats();
	const { data: sessions, isFetching: isFetchingSessions } = useSessions();
	const { data: sites } = useSites();
	const isFullscreen = useFullscreen();
	const updateSessionMetadata = useUpdateSessionMetadata();
	const { width, isResizing, listCollapsed, collapseList, expandList, startResize } = panel;
	const [ compact, setCompact ] = useState( readStoredCompactPreference );
	const [ archivedOpen, setArchivedOpen ] = useState( false );
	const site = siteId ? sites?.find( ( candidate ) => candidate.id === siteId ) : undefined;
	const scopedSessions = siteId
		? site?.path
			? ( sessions ?? [] ).filter( ( session ) => session.ownerSitePath === site.path )
			: []
		: ( sessions ?? [] ).filter( ( session ) => ! session.ownerSitePath );
	const chatSessions = [ ...scopedSessions ].sort(
		( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt )
	);
	const starredSessions = chatSessions.filter(
		( session ) => session.starred && ! session.archived
	);
	const regularSessions = chatSessions.filter(
		( session ) => ! session.starred && ! session.archived
	);
	const archivedSessions = chatSessions.filter( ( session ) => session.archived );
	const selectedSession =
		chatSessions.find( ( session ) => session.id === selectedSessionId ) ??
		( sessions ?? [] ).find( ( session ) => session.id === selectedSessionId );
	const isListCollapsed = expanded && listCollapsed;

	useEffect( () => {
		if ( selectedSessionId && sessions && ! isFetchingSessions && ! selectedSession ) {
			clearSelection();
		}
	}, [ clearSelection, isFetchingSessions, selectedSession, selectedSessionId, sessions ] );

	useEffect( () => {
		persistCompactPreference( compact );
	}, [ compact ] );

	const updateSessionArchived = ( session: AiSessionSummary, archived: boolean ) => {
		void updateSessionMetadata.mutateAsync( {
			sessionId: session.id,
			patch: {
				archived,
				starred: session.starred,
			},
		} );
	};

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
					data-ui-desks-chat-dropzone={ expanded && selectedSessionId ? 'true' : undefined }
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
						<div
							className={ styles.listPane }
							data-compact={ compact ? 'true' : 'false' }
							data-archived-open={ archivedOpen ? 'true' : 'false' }
						>
							<header className={ styles.header }>
								<h2>{ __( 'Conversations' ) }</h2>
								<div className={ styles.headerActions }>
									<Button
										variant="quiet"
										size="small"
										className={ styles.headerAction }
										data-active={ compact ? 'true' : 'false' }
										aria-pressed={ compact }
										icon={ compact ? buttons : formatListBullets }
										label={ compact ? __( 'Expand list' ) : __( 'Compact list' ) }
										onClick={ () => setCompact( ( current ) => ! current ) }
									/>
									<Button
										variant="quiet"
										size="small"
										className={ styles.headerAction }
										icon={ plus }
										label={ __( 'New chat' ) }
										disabled={ isCreatingChat }
										aria-busy={ isCreatingChat }
										onClick={ () => void startNewChat() }
									/>
								</div>
							</header>
							<div className={ styles.list }>
								{ starredSessions.length > 0 ? (
									<section className={ styles.sessionSection } data-kind="starred">
										<div className={ styles.sessionSectionLabel }>{ __( 'Starred' ) }</div>
										{ starredSessions.map( ( session ) => (
											<ChatSessionRow
												key={ session.id }
												session={ session }
												active={ session.id === selectedSessionId }
												metadataPending={ updateSessionMetadata.isPending }
												onSelect={ selectSession }
												onArchiveChange={ updateSessionArchived }
											/>
										) ) }
									</section>
								) : null }
								<section className={ styles.sessionSection } data-kind="regular">
									{ regularSessions.map( ( session ) => (
										<ChatSessionRow
											key={ session.id }
											session={ session }
											active={ session.id === selectedSessionId }
											metadataPending={ updateSessionMetadata.isPending }
											onSelect={ selectSession }
											onArchiveChange={ updateSessionArchived }
										/>
									) ) }
									{ starredSessions.length === 0 && regularSessions.length === 0 ? (
										<div className={ styles.emptyList }>{ __( 'No conversations yet.' ) }</div>
									) : null }
								</section>
							</div>
							{ archivedSessions.length > 0 ? (
								<div className={ styles.archived } data-open={ archivedOpen ? 'true' : 'false' }>
									<button
										type="button"
										className={ styles.archivedToggle }
										aria-expanded={ archivedOpen }
										onClick={ () => setArchivedOpen( ( current ) => ! current ) }
									>
										<span>{ __( 'Archived' ) }</span>
										<span className={ styles.archivedCount }>{ archivedSessions.length }</span>
									</button>
									{ archivedOpen ? (
										<div className={ styles.archivedList }>
											{ archivedSessions.map( ( session ) => (
												<ChatSessionRow
													key={ session.id }
													session={ session }
													active={ session.id === selectedSessionId }
													metadataPending={ updateSessionMetadata.isPending }
													onSelect={ selectSession }
													onArchiveChange={ updateSessionArchived }
												/>
											) ) }
										</div>
									) : null }
								</div>
							) : null }
							<footer className={ styles.footer }>
								<Button
									className={ styles.newChatButton }
									label={ __( 'New chat' ) }
									size="xlarge"
									disabled={ isCreatingChat }
									aria-busy={ isCreatingChat }
									onClick={ () => void startNewChat() }
									variant="quiet"
								>
									{ isCreatingChat ? __( 'Creating chat...' ) : __( '+ New chat' ) }
								</Button>
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
								<EmptyChatState
									authRequiredPrompt={ authRequiredPrompt }
									onContinuePrompt={ startChatWithPrompt }
								/>
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
				{ composerWidgetDragPreview && (
					<div
						className={ styles.widgetDragPreview }
						style={
							{
								'--desk-widget-drag-preview-x': `${ composerWidgetDragPreview.x }px`,
								'--desk-widget-drag-preview-y': `${ composerWidgetDragPreview.y }px`,
							} as CSSProperties
						}
						aria-hidden="true"
					>
						<WidgetContextThumbnailList
							widgets={ composerWidgetDragPreview.widgets }
							className={ styles.widgetDragPreviewThumbnails }
						/>
					</div>
				) }
			</Dialog.Portal>
		</Dialog.Root>
	);
}
