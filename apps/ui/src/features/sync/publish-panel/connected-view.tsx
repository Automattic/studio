import { __, sprintf } from '@wordpress/i18n';
import { DownloadIcon, HistoryIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useConnector } from '@/data/core';
import { useStartSite } from '@/data/queries/use-sites';
import {
	useCancelSync,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { ExternalLinkIcon, SyncIcon } from '@/lib/icons';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	FieldSet,
	FieldLegend,
	Menu,
} from '@/lib/ui';
import { FilePicker } from './file-picker';
import {
	backupsUrl,
	overwriteDescription,
	scopeLabel,
	websiteAddress,
	websiteIssue,
	type PublishView,
} from './options';
import { ErrorMessage, PanelBody, TransferProgress } from './parts';
import styles from './style.module.css';
import { useTransferSelection } from './use-transfer-selection';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

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
					<ExternalLinkIcon />
				</Menu.Item>
			) : null }
			<Menu.Separator />
			<Menu.Item disabled={ disabled } onClick={ () => onOpen( 'websites' ) }>
				{ __( 'Connected site…' ) }
			</Menu.Item>
		</>
	);
}

export function ConnectedView( {
	site,
	remote,
	connectedWebsite,
	activity,
	view,
	setView,
	open,
	disabled,
	offline,
	accessIssue,
}: {
	site: SiteDetails;
	remote: SyncSite;
	connectedWebsite: ReactNode;
	activity: SyncActivity | null;
	view: PublishView;
	setView: ( view: PublishView ) => void;
	open: boolean;
	disabled: boolean;
	offline: boolean;
	accessIssue?: string;
} ) {
	const [ reviewing, setReviewing ] = useState( view === 'pull' || activity?.kind === 'error' );
	const [ dismissedActivity, setDismissedActivity ] = useState< SyncActivity | null >( null );
	const connector = useConnector();
	useEffect( () => {
		if ( view === 'pull' ) setReviewing( true );
		if ( view === 'websites' ) setReviewing( false );
	}, [ view ] );
	useEffect( () => {
		if ( open && activity?.kind === 'error' && activity !== dismissedActivity )
			setReviewing( true );
	}, [ activity, dismissedActivity, open ] );
	useEffect( () => {
		if ( activity?.kind === 'success' && activity.direction === 'push' ) setReviewing( false );
	}, [ activity?.kind, activity?.direction ] );
	useEffect( () => {
		if ( ! open ) setReviewing( false );
	}, [ open ] );
	const id = useId();
	const cancelButton = useRef< HTMLButtonElement >( null );
	const publishButton = useRef< HTMLButtonElement >( null );
	const pullButton = useRef< HTMLButtonElement >( null );
	const pushSite = usePushSiteToLive();
	const pullSite = usePullSiteFromLive();
	const cancel = useCancelSync();
	const startSite = useStartSite();
	const pending = activity?.kind === 'pending';
	const direction =
		view === 'pull' || ( pending && activity.direction === 'pull' ) ? 'pull' : 'push';
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
		activity !== dismissedActivity &&
		activity?.kind !== 'pending' &&
		activity?.direction === direction
			? activity
			: null;
	const pulledLocally =
		finished?.kind === 'error' && finished.direction === 'pull' && finished.localChangesApplied;
	const restartFailed = pulledLocally && ! site.running;
	const completePull =
		view === 'pull' && ( finished?.kind === 'success' || ( pulledLocally && site.running ) );
	const close = () => {
		setDismissedActivity( activity );
		setReviewing( false );
		setView( 'publish' );
	};
	const start = () => {
		const variables = { siteId: site.id, remoteSiteId: remote.id, syncSite: remote };
		if ( direction === 'push' )
			pushSite.mutate( { ...variables, options: selection.options.push } );
		else pullSite.mutate( { ...variables, options: selection.options.pull } );
	};
	const choices = [
		{ value: 'all', label: __( 'Entire site' ) },
		{ value: 'files', label: __( 'Files only' ) },
		{ value: 'content', label: __( 'Content and settings only' ) },
		{ value: 'custom', label: __( 'Choose files…' ) },
	] as const;
	if ( pending ) {
		return (
			<PanelBody>
				<p className={ styles.address }>{ websiteAddress( remote ) }</p>
				<TransferProgress
					siteId={ site.id }
					activity={ activity }
					scopeLabel={ scopeLabel( ( activity.direction === 'pull' ? pull : push ).scope ) }
					cancel={ () =>
						cancel.mutate( { siteId: site.id, remoteSiteId: activity.remoteSiteId ?? remote.id } )
					}
					cancelling={ cancel.isPending }
				/>
			</PanelBody>
		);
	}
	return (
		<>
			<div className={ styles.connectedHome } data-connected-home>
				<div className={ styles.publishDetailsIntro }>
					<h2 className={ styles.publishDetailsHeading }>{ __( 'Publish details' ) }</h2>
					<p className={ styles.publishDetailsDescription }>
						{ __( 'Publish changes or get the latest updates.' ) }{ ' ' }
						<Button
							variant="inline-accent"
							size="inline"
							onClick={ () =>
								void connector.openExternalUrl(
									'https://developer.wordpress.com/docs/developer-tools/studio/sync/'
								)
							}
						>
							{ __( 'Learn more…' ) }
						</Button>
					</p>
				</div>
				{ connectedWebsite }
				{ issue && ! reviewing ? <p className={ styles.text }>{ issue }</p> : null }
				<div className={ styles.connectedActions }>
					<Button
						ref={ pullButton }
						variant="outline"
						size="lg"
						disabled={ disabled || Boolean( issue ) }
						onClick={ () => {
							setView( 'pull' );
							setReviewing( true );
						} }
					>
						{ __( 'Pull changes' ) }
					</Button>
					<Button
						ref={ publishButton }
						variant="default"
						size="lg"
						disabled={ disabled || Boolean( issue ) }
						onClick={ () => {
							setView( 'publish' );
							setReviewing( true );
						} }
					>
						{ __( 'Publish changes' ) }
					</Button>
				</div>
			</div>
			<AlertDialog
				open={ open && reviewing }
				onOpenChange={ ( next ) => ! next && ! pending && close() }
			>
				<DialogContent
					layout="confirmation"
					initialFocus={ cancelButton }
					finalFocus={ direction === 'push' ? publishButton : pullButton }
					closeButtonDisabled={ pending }
				>
					<DialogHeader>
						<DialogTitle>
							{ sprintf(
								/* translators: %s: website address. */
								direction === 'push'
									? __( 'Publish changes to %s?' )
									: __( 'Pull changes from %s?' ),
								websiteAddress( remote )
							) }
						</DialogTitle>
						{ ! pending && ! restartFailed && ! completePull ? (
							<DialogDescription tone="default">
								{ overwriteDescription( selection.scope, direction ) }
							</DialogDescription>
						) : null }
					</DialogHeader>
					{ restartFailed ? (
						<>
							<span className={ styles.heading } role="status">
								{ __( 'Changes pulled into WordPress Studio' ) }
							</span>
							<ErrorMessage error={ finished?.kind === 'error' ? finished.message : undefined } />
							<Button
								disabled={ startSite.isPending }
								onClick={ () => startSite.mutate( site.id ) }
							>
								{ startSite.isPending ? __( 'Starting site…' ) : __( 'Start site' ) }
							</Button>
						</>
					) : completePull ? (
						<>
							<p role="status">{ __( 'Changes pulled into WordPress Studio' ) }</p>
							<p className={ styles.text }>{ __( 'Your website wasn’t changed.' ) }</p>
							<DialogFooter>
								<Button onClick={ close }>{ __( 'Done' ) }</Button>
							</DialogFooter>
						</>
					) : (
						<>
							<FieldSet
								key={ `${ direction }-${ selection.fullOnly }` }
								role="radiogroup"
								aria-label={ direction === 'push' ? __( 'What to publish' ) : __( 'What to pull' ) }
								disabled={ disabled || selection.loadingFiles || selection.fullOnly }
								className={ styles.scopeChoices }
							>
								<FieldLegend variant="label">{ __( 'Include' ) }</FieldLegend>
								{ choices.map( ( choice ) => (
									<label key={ choice.value } className={ styles.scopeChoice }>
										<input
											type="radio"
											name={ `${ id }-scope` }
											value={ choice.value }
											defaultChecked={ selection.scope === choice.value }
											onChange={ () => selection.setScope( choice.value ) }
										/>
										<span>{ choice.label }</span>
									</label>
								) ) }
							</FieldSet>
							{ selection.scope === 'custom' ? <FilePicker selection={ selection } /> : null }
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
							<DialogFooter>
								<Button ref={ cancelButton } variant="outline" onClick={ close }>
									{ __( 'Cancel' ) }
								</Button>
								<Button
									variant="default"
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
										? __( 'Publish changes' )
										: __( 'Pull changes' ) }
								</Button>
							</DialogFooter>
						</>
					) }
				</DialogContent>
			</AlertDialog>
		</>
	);
}
