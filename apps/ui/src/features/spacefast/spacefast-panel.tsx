import { __ } from '@wordpress/i18n';
import { EllipsisIcon } from 'lucide-react';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { useCopyText } from '@/data/host/use-copy-text';
import { usePublishToSpacefast } from '@/data/queries/use-publish-to-spacefast';
import { useIsSiteBusy } from '@/data/queries/use-sites';
import {
	useDisconnectSpacefastSite,
	useSpacefastConnection,
	useSpacefastLogin,
	useSpacefastSignedIn,
	useSpacefastSpaces,
	useSpacefastTeams,
} from '@/data/queries/use-spacefast';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { SiteCard, getWebsiteThumbnailUrl } from '@/features/site-card';
import { useOffline } from '@/lib/hooks';
import { DisconnectIcon, DuplicateIcon, GlobeIcon, PlusIcon } from '@/lib/icons';
import {
	Button,
	CommandList,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	IconButton,
	Menu,
	Spinner,
	VisuallyHidden,
} from '@/lib/ui';
import { SpacefastLogo } from './spacefast-logo';
import styles from './style.module.css';
import type { SiteDetails, SpacefastConnection } from '@/data/core';

const NEW_SPACE = 'new-space';

const stripProtocol = ( url: string ) => url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );

// Spacefast shows up once the user connects it in Settings, or for a site that already
// publishes to a Space, so that Space stays reachable after disconnecting.
export function useSpacefastAvailable( siteId: string ) {
	const signedIn = useSpacefastSignedIn();
	const connection = useSpacefastConnection( siteId );
	return !! signedIn.data || !! connection.data;
}

export function SpacefastPanel( { site, open }: { site: SiteDetails; open: boolean } ) {
	const signedIn = useSpacefastSignedIn();
	const connection = useSpacefastConnection( site.id );
	const activity = useSiteSyncActivity( site.id );
	const publish = usePublishToSpacefast();
	const login = useSpacefastLogin();
	const offline = useOffline();
	const siteBusy = useIsSiteBusy( site );
	const [ choosing, setChoosing ] = useState( false );
	const spacefastActivity = activity?.direction === 'spacefast' ? activity : null;
	const disabled = offline || siteBusy || publish.isPending;

	if ( spacefastActivity?.kind === 'pending' ) {
		return (
			<div className={ styles.content }>
				<div className={ styles.progress } role="status" aria-live="polite">
					<Spinner aria-hidden="true" />
					<span className={ styles.heading }>
						{ spacefastActivity.message || __( 'Publishing to Spacefast…' ) }
					</span>
				</div>
			</div>
		);
	}
	if ( signedIn.isLoading || connection.isLoading ) {
		return (
			<div className={ styles.loading }>
				<Spinner aria-label={ __( 'Loading…' ) } />
			</div>
		);
	}
	const error = spacefastActivity?.kind === 'error' ? spacefastActivity.message : null;
	if ( connection.data && ! choosing ) {
		return (
			<div className={ styles.content }>
				<ConnectedSpace
					siteId={ site.id }
					connection={ connection.data }
					open={ open }
					disabled={ disabled }
				/>
				{ error ? <p className={ styles.error }>{ error }</p> : null }
				<div className={ styles.actions }>
					<Button
						variant="outline"
						size="lg"
						disabled={ disabled || ! signedIn.data }
						onClick={ () => setChoosing( true ) }
					>
						{ __( 'Change Space…' ) }
					</Button>
					{ signedIn.data ? (
						<Button
							size="lg"
							disabled={ disabled }
							onClick={ () =>
								publish.mutate( {
									siteId: site.id,
									target: { spaceId: connection.data!.spaceId },
								} )
							}
						>
							{ __( 'Publish' ) }
						</Button>
					) : (
						<Button
							size="lg"
							disabled={ offline }
							loading={ login.isPending }
							loadingAnnouncement={ __( 'Waiting for approval' ) }
							onClick={ () => login.mutate() }
						>
							{ __( 'Connect Spacefast' ) }
						</Button>
					) }
				</div>
			</div>
		);
	}
	return (
		<div className={ styles.content } data-choosing-space>
			<EmptyHeader className={ styles.intro }>
				<EmptyMedia className={ styles.logo }>
					<SpacefastLogo />
				</EmptyMedia>
				<h2 className={ styles.title }>{ __( 'Publish a static copy to Spacefast' ) }</h2>
				<EmptyDescription className={ styles.description }>
					{ __(
						'Studio exports your site as static files. Forms, comments and search won’t work on the copy.'
					) }
				</EmptyDescription>
			</EmptyHeader>
			{ error ? <p className={ styles.error }>{ error }</p> : null }
			<SpacePicker site={ site } disabled={ disabled } onPublished={ () => setChoosing( false ) } />
			{ choosing ? (
				<Button variant="outline" onClick={ () => setChoosing( false ) }>
					{ __( 'Cancel' ) }
				</Button>
			) : null }
		</div>
	);
}

function SpacePicker( {
	site,
	disabled,
	onPublished,
}: {
	site: SiteDetails;
	disabled: boolean;
	onPublished: () => void;
} ) {
	const spaces = useSpacefastSpaces( true );
	const teams = useSpacefastTeams( true );
	const publish = usePublishToSpacefast();
	const [ highlighted, setHighlighted ] = useState< string >();
	const team = teams.data?.[ 0 ];

	if ( spaces.isLoading ) {
		return (
			<div className={ styles.loading }>
				<Spinner aria-label={ __( 'Loading Spaces…' ) } />
			</div>
		);
	}
	if ( spaces.error ) {
		return (
			<div className={ styles.loading }>
				<p className={ styles.error }>{ spaces.error.message }</p>
				<Button variant="outline" onClick={ () => void spaces.refetch() }>
					{ __( 'Try again' ) }
				</Button>
			</div>
		);
	}
	return (
		<CommandList
			label={ __( 'Spaces' ) }
			radius="control"
			size="default"
			className={ styles.spaceList }
			groups={ [
				{
					label: __( 'New' ),
					items: [
						{
							value: NEW_SPACE,
							label: __( 'New Space' ),
							description: team?.name,
							icon: PlusIcon,
							disabled: disabled || ! team,
						},
					],
				},
				{
					label: __( 'Spaces' ),
					heading: spaces.data?.length ? __( 'Spaces' ) : undefined,
					items: ( spaces.data ?? [] ).map( ( space ) => ( {
						value: space.id,
						label: space.title,
						description: stripProtocol( space.liveUrl ),
						icon: GlobeIcon,
						disabled,
					} ) ),
				},
			] }
			highlighted={ highlighted }
			onHighlight={ setHighlighted }
			onSelect={ ( value ) => {
				const target =
					value === NEW_SPACE ? team && { teamId: team.id, title: site.name } : { spaceId: value };
				if ( target ) {
					publish.mutate( { siteId: site.id, target } );
					onPublished();
				}
			} }
		/>
	);
}

function ConnectedSpace( {
	siteId,
	connection,
	open,
	disabled,
}: {
	siteId: string;
	connection: SpacefastConnection;
	open: boolean;
	disabled: boolean;
} ) {
	const connector = useConnector();
	const disconnect = useDisconnectSpacefastSite();
	const { copied, copy } = useCopyText( connection.liveUrl );
	return (
		<>
			<SiteCard
				thumbnailUrl={ getWebsiteThumbnailUrl( connection.liveUrl ) }
				title={
					<Button
						variant="inline-link"
						size="inline"
						className={ styles.address }
						aria-label={ __( 'Visit site' ) }
						onClick={ () => void connector.openExternalUrl( connection.liveUrl ) }
					>
						{ stripProtocol( connection.liveUrl ) }
					</Button>
				}
				updatedAt={ connection.lastPublishedAt }
				active={ open }
				description={ connection.title }
				actions={
					<Menu.Root modal={ false }>
						<Menu.Trigger
							render={
								<IconButton
									variant="muted-ghost"
									size="icon-sm"
									icon={ <EllipsisIcon /> }
									label={ __( 'Space actions' ) }
								/>
							}
						/>
						<Menu.Popup side="right" align="start">
							<Menu.Item onClick={ copy }>
								<DuplicateIcon />
								{ __( 'Copy link' ) }
							</Menu.Item>
							<Menu.Separator />
							<Menu.Item
								destructive
								disabled={ disabled || disconnect.isPending }
								onClick={ () => disconnect.mutate( siteId ) }
							>
								<DisconnectIcon />
								{ __( 'Disconnect' ) }
							</Menu.Item>
						</Menu.Popup>
					</Menu.Root>
				}
			/>
			<VisuallyHidden role="status" aria-live="polite">
				{ copied ? __( 'Copied' ) : '' }
			</VisuallyHidden>
		</>
	);
}
