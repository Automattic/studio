import { __, sprintf } from '@wordpress/i18n';
import {
	backup,
	check,
	cloudUpload,
	download,
	arrowUpRight,
	globe,
	moreHorizontal,
} from '@wordpress/icons';
import { Button, Icon, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useId, useRef, useState } from 'react';
import * as Menu from '@/components/menu';
import { useConnector } from '@/data/core';
import {
	useCancelSync,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useUserLocale } from '@/data/queries/use-user-locale';
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
import { ErrorMessage, MenuSelect, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import { useTransferSelection } from './use-transfer-selection';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

function lastTransfer( timestamp: string | null, direction: TransferDirection, locale?: string ) {
	if ( ! timestamp ) {
		return direction === 'push'
			? __( 'Not yet published from Studio' )
			: __( 'Not yet pulled into Studio' );
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
					<Icon icon={ cloudUpload } size={ 20 } />
					{ __( 'Publish changes…' ) }
				</Menu.Item>
			) : null }
			<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'pull' ) }>
				<Icon icon={ download } size={ 20 } />
				{ __( 'Pull changes…' ) }
			</Menu.Item>
			{ backups ? (
				<Menu.Item onClick={ () => void connector.openExternalUrl( backups ) }>
					<Icon icon={ backup } size={ 20 } />
					{ __( 'View backups' ) }
					<Icon icon={ arrowUpRight } size={ 16 } />
				</Menu.Item>
			) : null }
			<Menu.Separator />
			<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'websites' ) }>
				<Icon icon={ globe } size={ 20 } />
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
} ) {
	const id = useId();
	const connector = useConnector();
	const locale = useUserLocale();
	const actions = useRef< HTMLButtonElement >( null );
	const [ filesDirection, setFilesDirection ] = useState< TransferDirection >( 'push' );
	const pushSite = usePushSiteToLive();
	const pullSite = usePullSiteFromLive();
	const cancel = useCancelSync();
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
	const issue = websiteIssue( remote );
	const finished =
		activity?.kind !== 'pending' && activity?.direction === direction ? activity : null;
	const completePull = view === 'pull' && finished?.kind === 'success';
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
							<MenuSelect
								id={ `${ id }-website` }
								wide
								value={ remote.id }
								label={ __( 'Website' ) }
								display={ websiteAddress( remote ) }
								disabled={ disabled }
								items={ websites.map( ( website ) => ( {
									value: website.id,
									label: `${ websiteAddress( website ) } · ${ websiteLabel( website ) }`,
								} ) ) }
								onChange={ selectWebsite }
							/>
						) : (
							<div className={ styles.website }>
								<span className={ styles.heading }>{ websiteAddress( remote ) }</span>
								<IconButton
									variant="minimal"
									tone="neutral"
									size="small"
									className={ styles.openWebsite }
									icon={ arrowUpRight }
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
				) : completePull ? (
					<>
						<div className={ styles.success } role="status">
							<span className={ styles.progressTitle }>
								<Icon icon={ check } size={ 16 } />
								<span className={ styles.heading }>{ __( 'Changes pulled into Studio' ) }</span>
							</span>
							<p className={ styles.text }>{ __( 'Your website wasn’t changed.' ) }</p>
						</div>
						<Button variant="solid" tone="neutral" className="studio-control" onClick={ back }>
							{ __( 'Done' ) }
						</Button>
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
								<MenuSelect< PublishScope >
									id={ `${ id }-scope` }
									value={ selection.scope }
									label={ direction === 'push' ? __( 'What to publish' ) : __( 'What to pull' ) }
									display={ scopeLabel( selection.scope ) }
									disabled={ disabled || selection.loading || selection.fullOnly }
									items={ ( [ 'all', 'files', 'content', 'custom' ] as const ).map( ( value ) => ( {
										value,
										label: value === 'custom' ? __( 'Choose files…' ) : scopeLabel( value ),
									} ) ) }
									onChange={ chooseScope }
								/>
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
						{ finished?.kind === 'cancelled' ? (
							<p className={ styles.text } role="status">
								{ __( 'Transfer cancelled. You can try again.' ) }
							</p>
						) : null }
						{ view === 'files' ? (
							<Button
								variant="outline"
								tone="neutral"
								className={ clsx( 'studio-control', styles.outline ) }
								onClick={ closeFiles }
							>
								{ __( 'Done' ) }
							</Button>
						) : (
							<div className={ styles.footer }>
								<Button
									variant="solid"
									tone={ direction === 'push' ? 'brand' : 'neutral' }
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
													tone="neutral"
													className={ clsx( 'studio-control', styles.outline ) }
													icon={ moreHorizontal }
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
