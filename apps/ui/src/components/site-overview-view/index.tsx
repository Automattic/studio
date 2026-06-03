import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	box,
	chevronDown,
	chevronRight,
	pencil,
	starEmpty,
	starFilled,
	undo,
} from '@wordpress/icons';
import { Button, Dialog, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PreviewSplitContent } from '@/components/preview-split-frame';
import { ProgressiveBlur } from '@/components/progressive-blur';
import { SiteDropdown } from '@/components/site-dropdown';
import { SitePreviewToggleButton } from '@/components/site-preview-toggle-button';
import { SiteSettingsForm } from '@/components/site-settings-view';
import { useConnector } from '@/data/core';
import {
	SESSIONS_QUERY_KEY,
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionMetadata,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useKeyboardShortcut } from '@/hooks/use-keyboard-shortcut';
import { SessionUIProvider, useSessionPreviewUI } from '@/hooks/use-session-ui';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getKeyboardShortcut, getKeyboardShortcutDescriptor } from '@/lib/keyboard-shortcuts';
import { Composer } from '@/ui-classic/components/session-view/composer';
import styles from './style.module.css';
import type { SiteSettingsTabId } from '@/components/site-settings-view';
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
	const showPreview = preview.open;
	const [ composerBusy, setComposerBusy ] = useState( false );
	const [ composerError, setComposerError ] = useState< string | null >( null );
	const [ settingsOpen, setSettingsOpen ] = useState( false );
	const [ settingsTab, setSettingsTab ] = useState< SiteSettingsTabId >( 'general' );
	const [ archivedOpen, setArchivedOpen ] = useState( false );
	const [ selectedModel, setSelectedModel ] = useState< AiModelId >( DEFAULT_MODEL );

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

	const siteSessions = [ ...( sessions ?? [] ) ]
		.filter( ( session ) => session.ownerSitePath === site.path )
		.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) );
	const activeSessions = siteSessions.filter( ( session ) => ! session.archived );
	const archivedSessions = siteSessions.filter( ( session ) => session.archived );
	const isUpdatingSession =
		archiveSession.isPending || unarchiveSession.isPending || updateSessionMetadata.isPending;

	return (
		<>
			<PreviewSplitContent
				scrollClassName={ styles.scroll }
				composerOuterClassName={ styles.composerOuter }
				header={
					<SiteOverviewHeader
						site={ site }
						previewOpen={ showPreview }
						onTogglePreview={ preview.toggle }
						onOpenSettings={ () => setSettingsOpen( true ) }
					/>
				}
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
									sessions={ activeSessions }
									emptyText={ __( 'No active chats.' ) }
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
			<Dialog.Root open={ settingsOpen } onOpenChange={ setSettingsOpen }>
				<Dialog.Popup size="large">
					<Dialog.Header>
						<Dialog.Title>{ __( 'Site settings' ) }</Dialog.Title>
						<Dialog.CloseIcon />
					</Dialog.Header>
					<Dialog.Content>
						<SiteSettingsForm
							site={ site }
							activeTab={ settingsTab }
							onTabChange={ setSettingsTab }
							embedded
						/>
					</Dialog.Content>
				</Dialog.Popup>
			</Dialog.Root>
		</>
	);
}

function SiteOverviewHeader( {
	site,
	previewOpen,
	onTogglePreview,
	onOpenSettings,
}: {
	site: SiteDetails;
	previewOpen: boolean;
	onTogglePreview: () => void;
	onOpenSettings: () => void;
} ) {
	const sidebarCollapsed = useSidebarCollapsed();
	const isFullscreen = useFullscreen();
	const previewShortcut = getKeyboardShortcutDescriptor(
		getKeyboardShortcut( 'toggle-site-preview' )
	);

	return (
		<div className={ styles.header }>
			<ProgressiveBlur />
			<div
				className={ clsx(
					styles.headerContent,
					! sidebarCollapsed && styles.headerContentSidebarOpen
				) }
			>
				{ sidebarCollapsed && ! isFullscreen ? (
					<span className={ styles.trafficLightSpacer } aria-hidden="true" />
				) : null }
				<SiteDropdown
					site={ site }
					showSiteIcon={ sidebarCollapsed }
					onSettingsClick={ onOpenSettings }
				/>
				<span className={ styles.headerSpacer } aria-hidden="true" />
				<div className={ styles.headerActions }>
					<SitePreviewToggleButton
						previewOpen={ previewOpen }
						onTogglePreview={ onTogglePreview }
						shortcut={ previewShortcut }
					/>
				</div>
			</div>
		</div>
	);
}

function ActiveChatSection( {
	title,
	sessions,
	emptyText,
	archiveLabel,
	actionDisabled,
	onArchive,
	onToggleStar,
}: {
	title: string;
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
				<p className={ styles.emptyChats }>{ emptyText }</p>
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
	const label = session.title?.trim() || session.firstPrompt?.trim() || __( 'Untitled chat' );
	const description = session.description?.trim() || session.assistantReplyPreview?.trim();
	const starred = !! session.starred;
	const [ editOpen, setEditOpen ] = useState( false );

	return (
		<li className={ styles.chatRow }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.chatLink }
			>
				<span className={ styles.chatTitle }>{ label }</span>
				{ description ? <span className={ styles.chatMeta }>{ description }</span> : null }
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
						icon={ pencil }
						label={ __( 'Edit' ) }
						className={ styles.chatIconAction }
						onClick={ () => setEditOpen( true ) }
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
			<EditChatDetailsDialog session={ session } open={ editOpen } onOpenChange={ setEditOpen } />
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
	const label = session.title?.trim() || session.firstPrompt?.trim() || __( 'Untitled chat' );

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

function EditChatDetailsDialog( {
	session,
	open,
	onOpenChange,
}: {
	session: AiSessionSummary;
	open: boolean;
	onOpenChange: ( open: boolean ) => void;
} ) {
	const updateTitleDescription = useUpdateSessionTitleDescription();
	const generatedTitle = session.generatedTitle ?? session.firstPrompt ?? '';
	const generatedDescription = session.generatedDescription ?? session.assistantReplyPreview ?? '';
	const [ title, setTitle ] = useState( session.userTitle ?? generatedTitle );
	const [ description, setDescription ] = useState(
		session.userDescription ?? generatedDescription
	);

	useEffect( () => {
		if ( open ) {
			setTitle( session.userTitle ?? generatedTitle );
			setDescription( session.userDescription ?? generatedDescription );
		}
	}, [ generatedDescription, generatedTitle, open, session.userDescription, session.userTitle ] );

	const normalizeField = ( value: string ): string | undefined => {
		const trimmed = value.trim();
		return trimmed || undefined;
	};

	const getUserOverride = ( value: string, generatedFallback: string ): string | undefined => {
		const normalized = normalizeField( value );
		if ( ! normalized ) {
			return undefined;
		}
		return normalized === normalizeField( generatedFallback ) ? undefined : normalized;
	};

	const handleSubmit = async ( event: FormEvent ) => {
		event.preventDefault();
		await updateTitleDescription.mutateAsync( {
			sessionId: session.id,
			title: getUserOverride( title, generatedTitle ),
			description: getUserOverride( description, generatedDescription ),
		} );
		onOpenChange( false );
	};

	return (
		<Dialog.Root
			open={ open }
			onOpenChange={ ( next ) => {
				if ( ! updateTitleDescription.isPending ) {
					onOpenChange( next );
				}
			} }
		>
			<Dialog.Popup size="small">
				<form onSubmit={ handleSubmit }>
					<Dialog.Header>
						<Dialog.Title>{ __( 'Edit chat details' ) }</Dialog.Title>
					</Dialog.Header>
					<div className={ styles.dialogFields }>
						<label className={ styles.dialogField }>
							<span>{ __( 'Title' ) }</span>
							<input
								value={ title }
								onChange={ ( event ) => setTitle( event.target.value ) }
								placeholder={ generatedTitle || __( 'Untitled chat' ) }
							/>
						</label>
						<label className={ styles.dialogField }>
							<span>{ __( 'Description' ) }</span>
							<textarea
								value={ description }
								onChange={ ( event ) => setDescription( event.target.value ) }
								placeholder={ generatedDescription || __( 'Add a short description' ) }
								rows={ 3 }
							/>
						</label>
					</div>
					<Dialog.Footer>
						<Dialog.Action
							variant="minimal"
							tone="neutral"
							disabled={ updateTitleDescription.isPending }
						>
							{ __( 'Cancel' ) }
						</Dialog.Action>
						<Button
							type="submit"
							variant="solid"
							tone="brand"
							loading={ updateTitleDescription.isPending }
							loadingAnnouncement={ __( 'Saving chat details' ) }
						>
							{ __( 'Save' ) }
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
