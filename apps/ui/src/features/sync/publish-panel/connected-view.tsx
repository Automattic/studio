import { getSitesDescriptor, type SitesProviderId } from '@studio/providers';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useConnector } from '@/data/core';
import { useCancelSync, usePullSite, usePushSite } from '@/data/queries/use-sync-site';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { Button, FieldSet } from '@/lib/ui';
import { FilePicker } from './file-picker';
import { overwriteDescription, scopeLabel, type PublishView, type Website } from './options';
import { ErrorMessage, PanelBody, PanelHeader, TransferProgress } from './parts';
import styles from './style.module.css';
import { useTransferSelection } from './use-transfer-selection';
import type { SiteDetails } from '@/data/core';
import type { SyncActivity } from '@/data/sync-activity';

export function ConnectedView( {
	site,
	provider,
	remote,
	connectedWebsite,
	activity,
	view,
	setView,
	open,
	disabled,
	offline,
	accessIssue,
	headerContainer,
	onReviewingChange,
}: {
	site: SiteDetails;
	provider: SitesProviderId;
	remote: Website;
	connectedWebsite: ReactNode;
	activity: SyncActivity | null;
	view: PublishView;
	setView: ( view: PublishView ) => void;
	open: boolean;
	disabled: boolean;
	offline: boolean;
	accessIssue?: string;
	headerContainer: HTMLDivElement | null;
	onReviewingChange: ( reviewing: boolean ) => void;
} ) {
	const [ reviewing, setReviewing ] = useState( view === 'pull' || activity?.kind === 'error' );
	const [ dismissedActivity, setDismissedActivity ] = useState< SyncActivity | null >( null );
	const connector = useConnector();
	useEffect( () => {
		if ( view === 'pull' ) setReviewing( true );
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
	const publishButton = useRef< HTMLButtonElement >( null );
	const pullButton = useRef< HTMLButtonElement >( null );
	const sites = getSitesDescriptor( provider );
	const pushSite = usePushSite();
	const pullSite = usePullSite();
	const cancel = useCancelSync();
	const startSite = useStartSiteWithChat();
	const pending = activity?.kind === 'pending';
	useEffect( () => {
		onReviewingChange( reviewing && ! pending );
		return () => onReviewingChange( false );
	}, [ reviewing, pending, onReviewingChange ] );
	const direction =
		view === 'pull' || ( pending && activity.direction === 'pull' ) ? 'pull' : 'push';
	const push = useTransferSelection(
		site,
		provider,
		remote,
		'push',
		open && direction === 'push' && ! pending && ! offline
	);
	const pull = useTransferSelection(
		site,
		provider,
		remote,
		'pull',
		sites.pull && open && direction === 'pull' && ! pending && ! offline
	);
	const selection = direction === 'push' ? push : pull;
	const pullIssue = accessIssue ?? sites.issue( remote, 'pull' );
	const pushIssue = accessIssue ?? sites.issue( remote, 'push' );
	const issue = direction === 'pull' ? pullIssue : pushIssue;
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
		requestAnimationFrame(
			() => ( direction === 'push' ? publishButton : pullButton ).current?.focus()
		);
	};
	const start = () => {
		const variables = { provider, siteId: site.id, remoteSiteId: remote.id };
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
				<p className={ styles.address }>{ sites.address( remote ) }</p>
				<TransferProgress
					siteId={ site.id }
					activity={ activity }
					scopeLabel={
						sites.selective
							? scopeLabel( ( activity.direction === 'pull' ? pull : push ).scope )
							: undefined
					}
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
			{ ! reviewing ? (
				<div className={ styles.connectedHome } data-connected-home>
					<div className={ styles.publishDetailsIntro }>
						<h2 className={ styles.publishDetailsHeading }>{ __( 'Publish details' ) }</h2>
						<p className={ styles.publishDetailsDescription }>
							{ sites.pull
								? __( 'Publish changes or get the latest updates.' )
								: __( 'Publish your changes.' ) }{ ' ' }
							<Button
								variant="inline-accent"
								size="inline"
								onClick={ () => void connector.openExternalUrl( sites.intro.learnMoreUrl ) }
							>
								{ __( 'Learn more…' ) }
							</Button>
						</p>
					</div>
					{ connectedWebsite }
					{ issue ? <p className={ styles.text }>{ issue }</p> : null }
					<div className={ styles.connectedActions }>
						{ sites.pull ? (
							<Button
								ref={ pullButton }
								variant="outline"
								size="lg"
								disabled={ disabled || Boolean( pullIssue ) }
								onClick={ () => {
									setView( 'pull' );
									setReviewing( true );
								} }
							>
								{ __( 'Pull changes' ) }
							</Button>
						) : null }
						<Button
							ref={ publishButton }
							variant="accent"
							size="lg"
							disabled={ disabled || Boolean( pushIssue ) }
							onClick={ () => {
								setView( 'publish' );
								setReviewing( true );
							} }
						>
							{ __( 'Publish changes' ) }
						</Button>
					</div>
				</div>
			) : (
				<>
					{ headerContainer
						? createPortal(
								<PanelHeader
									className={ styles.pickerHeader }
									title={ direction === 'push' ? __( 'Publish changes' ) : __( 'Pull changes' ) }
									onBack={ close }
								/>,
								headerContainer
						  )
						: null }
					<div className={ styles.transferReview }>
						<div className={ styles.transferFields }>
							<p className={ styles.address }>{ sites.address( remote ) }</p>
							{ ! restartFailed && ! completePull ? (
								<p className={ styles.text }>
									{ overwriteDescription( direction, sites.selective ) }
								</p>
							) : null }
							{ restartFailed ? (
								<>
									<span className={ styles.heading } role="status">
										{ __( 'Changes pulled into WordPress Studio' ) }
									</span>
									<ErrorMessage
										error={ finished?.kind === 'error' ? finished.message : undefined }
									/>
									<Button
										variant="accent"
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
								</>
							) : (
								<>
									{ sites.selective ? (
										<FieldSet
											key={ `${ direction }-${ selection.filesUnavailable }` }
											role="radiogroup"
											aria-label={
												direction === 'push' ? __( 'What to publish' ) : __( 'What to pull' )
											}
											disabled={ disabled || selection.loadingFiles }
											className={ styles.scopeChoices }
										>
											{ choices.map( ( choice ) => (
												<label key={ choice.value } className={ styles.scopeChoice }>
													<input
														type="radio"
														name={ `${ id }-scope` }
														value={ choice.value }
														disabled={ choice.value === 'custom' && selection.filesUnavailable }
														defaultChecked={ selection.scope === choice.value }
														onChange={ () => selection.setScope( choice.value ) }
													/>
													<span>{ choice.label }</span>
												</label>
											) ) }
										</FieldSet>
									) : null }
									{ sites.selective && selection.scope === 'custom' ? (
										<FilePicker selection={ selection } />
									) : null }
									{ selection.filesUnavailable ? (
										<p className={ styles.text }>
											{ __( 'Choosing individual files requires a backup of this website.' ) }
										</p>
									) : null }
									{ offline ? (
										<p className={ styles.text }>
											{ __( 'Connect to the internet to publish or pull changes.' ) }
										</p>
									) : null }
									{ issue ? <p className={ styles.text }>{ issue }</p> : null }
									{ selection.warning ? (
										<p className={ styles.text }>{ selection.warning }</p>
									) : null }
									<ErrorMessage error={ selection.error } retry={ selection.retry } />
									{ finished?.kind === 'error' ? (
										<ErrorMessage error={ finished.message } />
									) : null }
									{ finished?.kind === 'error' &&
									direction === 'pull' &&
									! remote.lastPullTimestamp ? (
										<p className={ styles.text }>
											{ __( 'Your local site is saved. Retry to finish bringing in its content.' ) }
										</p>
									) : null }
									{ finished?.kind === 'cancelled' ? (
										<p className={ styles.text } role="status">
											{ __( 'Transfer cancelled. You can try again.' ) }
										</p>
									) : null }
								</>
							) }
						</div>
						{ ! restartFailed ? (
							<div className={ styles.transferFooter }>
								{ completePull ? (
									<Button size="lg" onClick={ close }>
										{ __( 'Done' ) }
									</Button>
								) : (
									<>
										<Button variant="outline" size="lg" onClick={ close }>
											{ __( 'Cancel' ) }
										</Button>
										<Button
											variant="accent"
											size="lg"
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
									</>
								) }
							</div>
						) : null }
					</div>
				</>
			) }
		</>
	);
}
