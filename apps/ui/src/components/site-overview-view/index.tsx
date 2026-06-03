import { Link } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { Button, Dialog } from '@wordpress/ui';
import { useEffect, useState } from 'react';
import { useConnector } from '@/data/core';
import {
	useArchiveSession,
	useSessions,
	useUnarchiveSession,
	useUpdateSessionTitleDescription,
} from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { formatRelativeTime } from '@/lib/format-relative-time';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import styles from './style.module.css';
import type { AiSessionSummary } from '@/data/core';
import type { FormEvent } from 'react';

export function SiteOverviewView( { siteId }: { siteId: string } ) {
	const connector = useConnector();
	const { data: sites, isLoading } = useSites();
	const { data: sessions, isLoading: isLoadingSessions } = useSessions();
	const archiveSession = useArchiveSession();
	const unarchiveSession = useUnarchiveSession();
	const site = sites?.find( ( candidate ) => candidate.id === siteId );

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

	const siteUrl = getSiteUrl( site );
	const siteSessions = [ ...( sessions ?? [] ) ]
		.filter( ( session ) => session.ownerSitePath === site.path )
		.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) );
	const activeSessions = siteSessions.filter( ( session ) => ! session.archived );
	const archivedSessions = siteSessions.filter( ( session ) => session.archived );
	const isUpdatingSession = archiveSession.isPending || unarchiveSession.isPending;

	return (
		<div className={ styles.root }>
			<div className={ styles.content }>
				<header className={ styles.header }>
					<div>
						<h1 className={ styles.title }>{ site.name }</h1>
						<p className={ styles.subtitle }>{ getSiteDisplayUrl( site ) }</p>
					</div>
					<Button
						variant="outline"
						tone="neutral"
						disabled={ ! site.running }
						onClick={ () => void connector.openExternalUrl( siteUrl ) }
					>
						{ __( 'Open site' ) }
					</Button>
				</header>
				<div className={ styles.details }>
					<Detail
						label={ __( 'Status' ) }
						value={ site.running ? __( 'Running' ) : __( 'Stopped' ) }
					/>
					<Detail label={ __( 'Local URL' ) } value={ getSiteDisplayUrl( site ) } />
					<Detail label={ __( 'Local path' ) } value={ site.path } />
					<Detail label={ __( 'PHP version' ) } value={ site.phpVersion } />
					<Detail
						label={ __( 'WordPress updates' ) }
						value={ site.isWpAutoUpdating === false ? __( 'Pinned' ) : __( 'Automatic' ) }
					/>
				</div>
				<section className={ styles.chats }>
					<header className={ styles.sectionHeader }>
						<h2 className={ styles.sectionTitle }>{ __( 'Chats' ) }</h2>
						<span className={ styles.sectionCount }>
							{ isLoadingSessions
								? __( 'Loading...' )
								: `${ activeSessions.length + archivedSessions.length }` }
						</span>
					</header>
					{ isLoadingSessions ? (
						<p className={ styles.emptyChats }>{ __( 'Loading chats...' ) }</p>
					) : siteSessions.length === 0 ? (
						<p className={ styles.emptyChats }>{ __( 'No chats for this site yet.' ) }</p>
					) : (
						<>
							<ChatSection
								title={ __( 'Active' ) }
								sessions={ activeSessions }
								emptyText={ __( 'No active chats.' ) }
								actionLabel={ __( 'Archive' ) }
								actionDisabled={ isUpdatingSession }
								onAction={ ( session ) => archiveSession.mutate( session ) }
							/>
							<ChatSection
								title={ __( 'Archived' ) }
								sessions={ archivedSessions }
								emptyText={ __( 'No archived chats.' ) }
								actionLabel={ __( 'Unarchive' ) }
								actionDisabled={ isUpdatingSession }
								onAction={ ( session ) => unarchiveSession.mutate( session ) }
							/>
						</>
					) }
				</section>
			</div>
		</div>
	);
}

function Detail( { label, value }: { label: string; value: string } ) {
	return (
		<div className={ styles.detail }>
			<div className={ styles.detailLabel }>{ label }</div>
			<div className={ styles.detailValue } title={ value }>
				{ value }
			</div>
		</div>
	);
}

function ChatSection( {
	title,
	sessions,
	emptyText,
	actionLabel,
	actionDisabled,
	onAction,
}: {
	title: string;
	sessions: AiSessionSummary[];
	emptyText: string;
	actionLabel: string;
	actionDisabled: boolean;
	onAction: ( session: AiSessionSummary ) => void;
} ) {
	return (
		<section className={ styles.chatSection }>
			<div className={ styles.chatSectionHeader }>
				<h3 className={ styles.chatSectionTitle }>{ title }</h3>
				<span className={ styles.chatSectionCount }>{ sessions.length }</span>
			</div>
			{ sessions.length === 0 ? (
				<p className={ styles.emptyChats }>{ emptyText }</p>
			) : (
				<ul className={ styles.chatList }>
					{ sessions.map( ( session ) => (
						<ChatRow
							key={ session.id }
							session={ session }
							actionLabel={ actionLabel }
							actionDisabled={ actionDisabled }
							onAction={ onAction }
						/>
					) ) }
				</ul>
			) }
		</section>
	);
}

function ChatRow( {
	session,
	actionLabel,
	actionDisabled,
	onAction,
}: {
	session: AiSessionSummary;
	actionLabel: string;
	actionDisabled: boolean;
	onAction: ( session: AiSessionSummary ) => void;
} ) {
	const label = session.title?.trim() || session.firstPrompt?.trim() || __( 'Untitled chat' );
	const description = session.description?.trim() || session.assistantReplyPreview?.trim();
	const [ editOpen, setEditOpen ] = useState( false );

	return (
		<li className={ styles.chatRow }>
			<Link
				to="/sessions/$sessionId"
				params={ { sessionId: session.id } }
				className={ styles.chatLink }
			>
				<span className={ styles.chatTitle }>{ label }</span>
				<span className={ styles.chatMeta }>
					{ description
						? `${ description } · ${ formatRelativeTime( session.updatedAt ) }`
						: formatRelativeTime( session.updatedAt ) }
				</span>
			</Link>
			<div className={ styles.chatActions }>
				<Button variant="minimal" size="small" onClick={ () => setEditOpen( true ) }>
					{ __( 'Edit' ) }
				</Button>
				<Button
					variant="minimal"
					size="small"
					disabled={ actionDisabled }
					onClick={ () => onAction( session ) }
				>
					{ actionLabel }
				</Button>
			</div>
			<EditChatDetailsDialog session={ session } open={ editOpen } onOpenChange={ setEditOpen } />
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
