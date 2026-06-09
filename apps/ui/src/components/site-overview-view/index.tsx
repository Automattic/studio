import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { box, chevronDown, chevronRight, starEmpty, starFilled, undo } from '@wordpress/icons';
import { Button, Icon, IconButton } from '@wordpress/ui';
import { useCallback, useMemo, useState } from 'react';
import { PreviewSplitContent } from '@/components/preview-split-frame';
import { useConnector } from '@/data/core';
import {
	SESSIONS_QUERY_KEY,
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionMetadata,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { Composer } from '@/ui-classic/components/session-view/composer';
import { SiteMenuHeader } from '@/ui-classic/components/site-menu-header';
import styles from './style.module.css';
import type { AiModelId, AiSessionSummary, SiteDetails } from '@/data/core';

export function SiteOverviewView( { siteId }: { siteId: string } ) {
	return (
		<SessionUIProvider>
			<SiteOverviewViewContent siteId={ siteId } />
		</SessionUIProvider>
	);
}

function SiteOverviewViewContent( { siteId }: { siteId: string } ) {
	const navigate = useNavigate();
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: sites, isLoading } = useSites();
	const { data: sessions, isLoading: isLoadingSessions } = useSessions();
	const archiveSession = useArchiveSession();
	const unarchiveSession = useUnarchiveSession();
	const updateSessionMetadata = useUpdateSessionMetadata();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );
	const preview = useSessionPreviewUI();
	const [ composerBusy, setComposerBusy ] = useState( false );
	const [ composerError, setComposerError ] = useState< string | null >( null );
	const [ archivedOpen, setArchivedOpen ] = useState( false );
	const [ selectedModel, setSelectedModel ] = useState< AiModelId >( DEFAULT_MODEL );
	const siteSessions = useMemo( () => {
		if ( ! site ) {
			return [];
		}
		return [ ...( sessions ?? [] ) ]
			.filter( ( session ) => session.ownerSitePath === site.path )
			.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) );
	}, [ sessions, site ] );
	const activeSessions = useMemo(
		() => siteSessions.filter( ( session ) => ! session.archived ),
		[ siteSessions ]
	);
	const archivedSessions = useMemo(
		() => siteSessions.filter( ( session ) => session.archived ),
		[ siteSessions ]
	);

	const sendNewChatMessage = useCallback(
		async ( prompt: string ) => {
			if ( ! site || composerBusy ) {
				return;
			}
			setComposerBusy( true );
			setComposerError( null );
			try {
				const session = await connector.createSession( site.id );
				if ( selectedModel !== DEFAULT_MODEL ) {
					await connector.setSessionModel( session.id, selectedModel );
				}
				await connector.continueSession( session.id, prompt, { displayMessage: prompt } );
				void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
				await navigate( {
					to: '/sessions/$sessionId',
					params: { sessionId: session.id },
				} );
			} catch ( error ) {
				const message = error instanceof Error ? error.message : __( 'Could not start chat.' );
				setComposerError( message );
				throw error;
			} finally {
				setComposerBusy( false );
			}
		},
		[ composerBusy, connector, navigate, queryClient, selectedModel, site ]
	);

	useKeyboardShortcut( 'toggle-site-preview', preview.toggle, {
		enabled: !! site,
	} );

	if ( isLoading ) {
		return <div className={ styles.state }>{ __( 'Loading...' ) }</div>;
	}

	if ( ! site ) {
		return (
			<div className={ styles.state }>
				<h1>{ __( 'Site not found' ) }</h1>
				<p>{ siteId }</p>
			</div>
		);
	}

	const isUpdatingSession =
		archiveSession.isPending || unarchiveSession.isPending || updateSessionMetadata.isPending;

	return (
		<>
			<PreviewSplitContent
				scrollClassName={ styles.scroll }
				composerOuterClassName={ styles.composerOuter }
				header={ <SiteOverviewHeader site={ site } /> }
				composer={
					<div className={ styles.classicColumn }>
						<Composer
							busy={ composerBusy }
							error={ composerError }
							model={ selectedModel }
							onModelChange={ setSelectedModel }
							onSend={ sendNewChatMessage }
							onInterrupt={ async () => undefined }
							autoFocus={ false }
						/>
					</div>
				}
			>
				<div className={ styles.content }>
					<section className={ styles.chats }>
						{ isLoadingSessions ? (
							<p className={ styles.emptyChats }>{ __( 'Loading chats...' ) }</p>
						) : siteSessions.length === 0 ? (
							<p className={ styles.emptyChats }>{ __( 'No chats for this site yet.' ) }</p>
						) : (
							<>
								<ActiveChatSection
									title={ __( 'Active' ) }
									siteId={ site.id }
									sessions={ activeSessions }
									emptyText={ __( 'No active chats' ) }
									archiveLabel={ __( 'Archive conversation' ) }
									actionDisabled={ isUpdatingSession }
									onArchive={ ( session ) => archiveSession.mutate( session ) }
									onToggleStar={ ( session ) =>
										updateSessionMetadata.mutate( {
											sessionId: session.id,
											patch: {
												starred: ! session.starred,
												archived: !! session.archived,
											},
										} )
									}
								/>
								<ArchivedChatSection
									title={ __( 'Archived' ) }
									sessions={ archivedSessions }
									emptyText={ __( 'No archived chats.' ) }
									unarchiveLabel={ __( 'Unarchive conversation' ) }
									actionDisabled={ isUpdatingSession }
									open={ archivedOpen }
									onToggle={ () => setArchivedOpen( ( current ) => ! current ) }
									onUnarchive={ ( session ) => unarchiveSession.mutate( session ) }
								/>
							</>
						) }
					</section>
				</div>
			</PreviewSplitContent>
		</>
	);
}

function SiteOverviewHeader( { site }: { site: SiteDetails } ) {
	return <SiteMenuHeader site={ site } inlineBleed="var(--site-overview-inline-padding)" />;
}

function ActiveChatSection( {
	title,
	siteId,
	sessions,
	emptyText,
	archiveLabel,
	actionDisabled,
	onArchive,
	onToggleStar,
}: {
	title: string;
	siteId: string;
	sessions: AiSessionSummary[];
	emptyText: string;
	archiveLabel: string;
	actionDisabled: boolean;
	onArchive: ( session: AiSessionSummary ) => void;
	onToggleStar: ( session: AiSessionSummary ) => void;
} ) {
	return (
		<section className={ styles.chatSection }>
			<div className={ styles.chatSectionHeader }>
				<h3 className={ styles.chatSectionTitle }>{ title }</h3>
			</div>
			{ sessions.length === 0 ? (
				<div className={ styles.activeEmptyChats }>
					<span>{ emptyText }</span>
					<span className={ styles.activeEmptySeparator } aria-hidden="true">
						•
					</span>
					<NewChatInlineButton siteId={ siteId } />
				</div>
			) : (
				<ul className={ styles.chatList }>
					{ sessions.map( ( session ) => (
						<ActiveChatRow
							key={ session.id }
							session={ session }
							archiveLabel={ archiveLabel }
							actionDisabled={ actionDisabled }
							onArchive={ onArchive }
							onToggleStar={ onToggleStar }
						/>
					) ) }
				</ul>
			) }
		</section>
	);
}

function NewChatInlineButton( { siteId }: { siteId: string } ) {
	const navigate = useNavigate();
	const [ isPending, setIsPending ] = useState( false );
	const handleClick = async () => {
		setIsPending( true );
		try {
			await navigate( {
				to: '/sites/$siteId/new',
				params: { siteId },
				search: { focusComposer: true },
			} );
		} finally {
			setIsPending( false );
		}
	};

	return (
		<Button
			variant="unstyled"
			tone="neutral"
			size="small"
			className={ styles.activeEmptyAction }
			loading={ isPending }
			loadingAnnouncement={ __( 'Creating chat' ) }
			onClick={ handleClick }
		>
			{ __( 'New chat' ) }
		</Button>
	);
}

function ArchivedChatSection( {
	title,
	sessions,
	emptyText,
	unarchiveLabel,
	actionDisabled,
	open,
	onToggle,
	onUnarchive,
}: {
	title: string;
	sessions: AiSessionSummary[];
	emptyText: string;
	unarchiveLabel: string;
	actionDisabled: boolean;
	open: boolean;
	onToggle: () => void;
	onUnarchive: ( session: AiSessionSummary ) => void;
} ) {
	return (
		<section className={ styles.archivedSection }>
			<button
				type="button"
				className={ styles.archivedToggle }
				aria-expanded={ open }
				onClick={ onToggle }
			>
				<span>{ title }</span>
				<Icon
					icon={ open ? chevronDown : chevronRight }
					size={ 14 }
					className={ styles.archivedToggleIcon }
					aria-hidden="true"
				/>
			</button>
			{ open ? (
				sessions.length === 0 ? (
					<p className={ styles.emptyChats }>{ emptyText }</p>
				) : (
					<ul className={ styles.archivedChatList }>
						{ sessions.map( ( session ) => (
							<ArchivedChatRow
								key={ session.id }
								session={ session }
								unarchiveLabel={ unarchiveLabel }
								actionDisabled={ actionDisabled }
								onUnarchive={ onUnarchive }
							/>
						) ) }
					</ul>
				)
			) : null }
		</section>
	);
}

function ActiveChatRow( {
	session,
	archiveLabel,
	actionDisabled,
	onArchive,
	onToggleStar,
}: {
	session: AiSessionSummary;
	archiveLabel: string;
	actionDisabled: boolean;
	onArchive: ( session: AiSessionSummary ) => void;
	onToggleStar: ( session: AiSessionSummary ) => void;
} ) {
	const label = session.firstPrompt?.trim() || __( 'Untitled chat' );
	const starred = !! session.starred;

	return (
		<li className={ styles.chatRow }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.chatLink }
			>
				<span className={ styles.chatTitle }>{ label }</span>
			</Link>
			<div className={ styles.chatEndSlot }>
				<span className={ styles.chatTime }>{ formatRelativeTime( session.updatedAt ) }</span>
				<div className={ styles.chatActions }>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ starred ? starFilled : starEmpty }
						label={ starred ? __( 'Unstar conversation' ) : __( 'Star conversation' ) }
						className={ styles.chatIconAction }
						data-active={ starred ? 'true' : 'false' }
						disabled={ actionDisabled }
						onClick={ () => onToggleStar( session ) }
					/>
					<IconButton
						variant="minimal"
						tone="neutral"
						size="small"
						icon={ box }
						label={ archiveLabel }
						className={ styles.chatIconAction }
						disabled={ actionDisabled }
						onClick={ () => onArchive( session ) }
					/>
				</div>
			</div>
		</li>
	);
}

function ArchivedChatRow( {
	session,
	unarchiveLabel,
	actionDisabled,
	onUnarchive,
}: {
	session: AiSessionSummary;
	unarchiveLabel: string;
	actionDisabled: boolean;
	onUnarchive: ( session: AiSessionSummary ) => void;
} ) {
	const label = session.firstPrompt?.trim() || __( 'Untitled chat' );

	return (
		<li className={ styles.archivedChatRow }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.archivedChatLink }
			>
				<span className={ styles.archivedChatTitle }>{ label }</span>
			</Link>
			<div className={ styles.archivedChatEndSlot }>
				<span className={ styles.archivedChatTime }>
					{ formatRelativeTime( session.updatedAt ) }
				</span>
				<IconButton
					variant="minimal"
					tone="neutral"
					size="small"
					icon={ undo }
					label={ unarchiveLabel }
					className={ styles.archivedChatAction }
					disabled={ actionDisabled }
					onClick={ () => onUnarchive( session ) }
				/>
			</div>
		</li>
	);
}
