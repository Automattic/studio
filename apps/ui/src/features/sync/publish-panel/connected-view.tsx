import { __, sprintf } from '@wordpress/i18n';
import {
	ArrowUpRightIcon,
	CheckIcon,
	DownloadIcon,
	EllipsisIcon,
	GlobeIcon,
	HistoryIcon,
} from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import * as Menu from '@/components/ui/menu';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import {
	useCancelSync,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useUserLocale } from '@/data/queries/use-user-locale';
import { SyncIcon } from '@/lib/icons/sync-icon';
import { FilePicker } from './file-picker';
import {
	backupsUrl,
	overwriteDescription,
	scopeLabel,
	websiteAddress,
	websiteEnvironment,
	websiteIssue,
	websiteLabel,
	type PublishScope,
	type PublishView,
	type TransferDirection,
} from './options';
import { ErrorMessage, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import { useTransferSelection } from './use-transfer-selection';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

function lastTransfer( timestamp: string | null, direction: TransferDirection, locale?: string ) {
	if ( ! timestamp ) {
		return direction === 'push'
			? __( 'Not yet published from WordPress Studio' )
			: __( 'Not yet pulled into WordPress Studio' );
	}
	return sprintf(
		/* translators: %s: date and time of the last transfer */
		direction === 'push' ? __( 'Last published %s' ) : __( 'Last pulled %s' ),
		new Date( timestamp ).toLocaleString( locale )
	);
}

// Pull, backups and website management for one connected website.
export function WebsiteMenuItems( {
	remote,
	disabled,
	includePublish = false,
	onOpen,
}: {
	remote: SyncSite;
	disabled: boolean;
	includePublish?: boolean;
	onOpen: ( view: 'publish' | 'pull' | 'websites' ) => void;
} ) {
	const connector = useConnector();
	const backups = backupsUrl( remote );
	return (
		<>
			{ includePublish ? (
				<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'publish' ) }>
					<SyncIcon />
					{ __( 'Publish changes…' ) }
				</Menu.Item>
			) : null }
			<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'pull' ) }>
				<DownloadIcon />
				{ __( 'Pull changes…' ) }
			</Menu.Item>
			{ backups ? (
				<Menu.Item onClick={ () => void connector.openExternalUrl( backups ) }>
					<HistoryIcon />
					{ __( 'View backups' ) }
					<ArrowUpRightIcon />
				</Menu.Item>
			) : null }
			<Menu.Separator />
			<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'websites' ) }>
				<GlobeIcon />
				{ __( 'Manage websites…' ) }
			</Menu.Item>
		</>
	);
}

export function ConnectedView( {
	site,
	remote,
	websites,
	activity,
	view,
	setView,
	selectWebsite,
	open,
	disabled,
	offline,
	accessIssue,
}: {
	site: SiteDetails;
	remote: SyncSite;
	websites: SyncSite[];
	activity: SyncActivity | null;
	view: PublishView;
	setView: ( view: PublishView ) => void;
	selectWebsite: ( id: number ) => void;
	open: boolean;
	disabled: boolean;
	offline: boolean;
	accessIssue?: string;
} ) {
	const id = useId();
	const connector = useConnector();
	const locale = useUserLocale();
	const actions = useRef< HTMLButtonElement >( null );
	const [ filesDirection, setFilesDirection ] = useState< TransferDirection >( 'push' );
	const pushSite = usePushSiteToLive();
	const pullSite = usePullSiteFromLive();
	const cancel = useCancelSync();
	const startSite = useStartSite();
	const pending = activity?.kind === 'pending';
	const direction =
		view === 'pull' || ( view === 'files' && filesDirection === 'pull' ) ? 'pull' : 'push';
	const push = useTransferSelection(
		site,
		remote,
		'push',
		open && direction === 'push' && ! pending && ! offline
	);
	const pull = useTransferSelection(
		site,
		remote,
		'pull',
		open && direction === 'pull' && ! pending && ! offline
	);
	const selection = direction === 'push' ? push : pull;
	const issue = accessIssue ?? websiteIssue( remote );
	const finished =
		activity?.kind !== 'pending' && activity?.direction === direction ? activity : null;
	const pulledLocally =
		activity?.kind === 'error' && activity.direction === 'pull' && activity.localChangesApplied;
	const restartFailed = pulledLocally && ! site.running && view !== 'files';
	const completePull =
		view === 'pull' && ( finished?.kind === 'success' || ( pulledLocally && site.running ) );
	const lastTimestamp = direction === 'push' ? remote.lastPushTimestamp : remote.lastPullTimestamp;
	const multiple = websites.length > 1 && direction === 'push';

	const chooseScope = ( scope: PublishScope ) => {
		selection.setScope( scope );
		if ( scope === 'custom' ) {
			setFilesDirection( direction );
			setView( 'files' );
		}
	};
	const start = () => {
		const variables = { siteId: site.id, remoteSiteId: remote.id, syncSite: remote };
		if ( direction === 'push' ) {
			pushSite.mutate( { ...variables, options: selection.options.push } );
		} else {
			pullSite.mutate( { ...variables, options: selection.options.pull } );
		}
	};
	const back = () => {
		setView( 'publish' );
		requestAnimationFrame( () => actions.current?.focus() );
	};
	const closeFiles = () => setView( filesDirection === 'pull' ? 'pull' : 'publish' );

	let title: string = __( 'Publish' );
	if ( view === 'files' ) {
		title = __( 'Choose files' );
	} else if ( view === 'pull' ) {
		title = __( 'Pull changes' );
	}

	return (
		<>
			<PanelHeader
				title={ title }
				onBack={ view === 'publish' ? undefined : view === 'files' ? closeFiles : back }
			/>
			<PanelBody
				insetTop={ view === 'publish' }
				loading={
					! pending &&
					! completePull &&
					! restartFailed &&
					( selection.loadingFiles || ( view !== 'files' && selection.loadingDetails ) )
				}
			>
				{ view === 'files' ? null : (
					<div className={ styles.field }>
						{ direction === 'push' ? (
							<p className={ styles.text }>
								<label htmlFor={ multiple ? `${ id }-website` : undefined }>
									{ __( 'Publish to' ) }
								</label>
							</p>
						) : null }
						{ multiple ? (
							<Select
								value={ remote.id }
								onValueChange={ ( value ) => value !== null && selectWebsite( value ) }
								items={ websites.map( ( website ) => ( {
									value: website.id,
									label: websiteAddress( website ),
								} ) ) }
							>
								<SelectTrigger
									id={ `${ id }-website` }
									fullWidth
									aria-label={ __( 'Website' ) }
									disabled={ disabled }
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{ websites.map( ( website ) => (
										<SelectItem key={ website.id } value={ website.id }>
											{ websiteAddress( website ) } · { websiteLabel( website ) }
										</SelectItem>
									) ) }
								</SelectContent>
							</Select>
						) : (
							<div className={ styles.website }>
								<span className={ styles.address } title={ websiteAddress( remote ) }>
									{ websiteAddress( remote ) }
								</span>
								<IconButton
									variant="muted-ghost"
									size="icon-2xs"
									icon={ <ArrowUpRightIcon /> }
									label={ __( 'Open website' ) }
									onClick={ () => void connector.openExternalUrl( remote.url ) }
								/>
							</div>
						) }
						{ pending ? null : (
							<p className={ styles.text }>
								{ websiteEnvironment( remote ) === 'production'
									? null
									: `${ websiteLabel( remote ) } · ` }
								{ lastTransfer( lastTimestamp, direction, locale ) }
							</p>
						) }
					</div>
				) }
				{ activity?.kind === 'pending' ? (
					<TransferProgress
						siteId={ site.id }
						activity={ activity }
						scopeLabel={ scopeLabel( ( activity.direction === 'pull' ? pull : push ).scope ) }
						cancel={ () =>
							cancel.mutate( {
								siteId: site.id,
								remoteSiteId: activity.remoteSiteId ?? remote.id,
							} )
						}
						cancelling={ cancel.isPending }
					/>
				) : restartFailed ? (
					<>
						<span className={ styles.heading } role="status">
							{ __( 'Changes pulled into WordPress Studio' ) }
						</span>
						<ErrorMessage error={ activity.message } />
						<Button disabled={ startSite.isPending } onClick={ () => startSite.mutate( site.id ) }>
							{ startSite.isPending ? __( 'Starting site…' ) : __( 'Start site' ) }
						</Button>
					</>
				) : completePull ? (
					<>
						<div className={ styles.success } role="status">
							<span className={ styles.progressTitle }>
								<CheckIcon />
								<span className={ styles.heading }>
									{ __( 'Changes pulled into WordPress Studio' ) }
								</span>
							</span>
							<p className={ styles.text }>{ __( 'Your website wasn’t changed.' ) }</p>
						</div>
						<Button onClick={ back }>{ __( 'Done' ) }</Button>
					</>
				) : (
					<>
						{ view === 'files' ? (
							<FilePicker selection={ selection } />
						) : (
							<div className={ styles.include }>
								<p className={ styles.text }>
									<label htmlFor={ `${ id }-scope` }>{ __( 'Include' ) }</label>
								</p>
								<Select
									value={ selection.scope }
									onValueChange={ ( value ) => value !== null && chooseScope( value ) }
								>
									<SelectTrigger
										id={ `${ id }-scope` }
										variant="ghost"
										size="xs"
										disabled={ disabled || selection.loading || selection.fullOnly }
										aria-label={
											direction === 'push' ? __( 'What to publish' ) : __( 'What to pull' )
										}
									>
										<SelectValue>{ scopeLabel( selection.scope ) }</SelectValue>
									</SelectTrigger>
									<SelectContent align="start" alignItemWithTrigger={ false }>
										{ ( [ 'all', 'files', 'content', 'custom' ] as const ).map( ( value ) => (
											<SelectItem
												key={ value }
												value={ value }
												onClick={ value === 'custom' ? () => chooseScope( value ) : undefined }
											>
												{ value === 'custom' ? __( 'Choose files…' ) : scopeLabel( value ) }
											</SelectItem>
										) ) }
									</SelectContent>
								</Select>
							</div>
						) }
						{ selection.fullOnly ? (
							<p className={ styles.text }>
								{ __(
									'Only a full-site pull is available until this website has a backup for selecting files.'
								) }
							</p>
						) : null }
						{ selection.scope === 'custom' && selection.blocked && ! selection.loading ? (
							<p className={ styles.text }>
								{ __( 'Choose at least one file or include content and settings.' ) }
							</p>
						) : null }
						{ offline ? (
							<p className={ styles.text }>
								{ __( 'Connect to the internet to publish or pull changes.' ) }
							</p>
						) : null }
						{ issue ? <p className={ styles.text }>{ issue }</p> : null }
						{ direction === 'pull' || ! remote.lastPushTimestamp ? (
							<p className={ styles.text }>
								{ overwriteDescription( selection.scope, direction ) }
							</p>
						) : null }
						{ selection.warning ? <p className={ styles.text }>{ selection.warning }</p> : null }
						<ErrorMessage error={ selection.error } retry={ selection.retry } />
						{ finished?.kind === 'error' ? <ErrorMessage error={ finished.message } /> : null }
						{ finished?.kind === 'error' && direction === 'pull' && ! remote.lastPullTimestamp ? (
							<p className={ styles.text }>
								{ __( 'Your local site is saved. Retry to finish bringing in its content.' ) }
							</p>
						) : null }
						{ finished?.kind === 'cancelled' ? (
							<p className={ styles.text } role="status">
								{ __( 'Transfer cancelled. You can try again.' ) }
							</p>
						) : null }
						{ view === 'files' ? (
							<Button variant="outline" onClick={ closeFiles }>
								{ __( 'Done' ) }
							</Button>
						) : (
							<div className={ styles.footer }>
								<Button
									variant={ direction === 'push' ? 'accent' : 'default' }
									className={ styles.primary }
									disabled={
										disabled ||
										selection.loading ||
										Boolean( selection.error ) ||
										selection.blocked ||
										Boolean( issue )
									}
									onClick={ start }
								>
									{ finished?.kind === 'error'
										? direction === 'push'
											? __( 'Try publishing again' )
											: __( 'Try pulling again' )
										: direction === 'push'
										? __( 'Publish' )
										: __( 'Pull changes' ) }
								</Button>
								{ direction === 'push' ? (
									<Menu.Root modal={ false }>
										<Menu.Trigger
											render={
												<IconButton
													ref={ actions }
													variant="outline"
													icon={ <EllipsisIcon /> }
													label={ __( 'Website actions' ) }
												/>
											}
										/>
										<Menu.Popup side="top" align="end">
											<WebsiteMenuItems remote={ remote } disabled={ pending } onOpen={ setView } />
										</Menu.Popup>
									</Menu.Root>
								) : null }
							</div>
						) }
					</>
				) }
			</PanelBody>
		</>
	);
}
