import { getLatestLinkedPreview, getPreviewPublishWarning } from '@studio/common/lib/snapshots';
import {
	AlertDialog,
	Button,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Select,
	SelectTrigger,
	SelectValue,
	SelectContent,
	SelectItem,
} from '@studio/ds';
import { getProviderSites, type RemoteSite, type SitesProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useId, useRef, useState, type RefObject } from 'react';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePreviewStatus } from '@/data/queries/use-preview-status';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePushSite, usePullSite } from '@/data/queries/use-sync-site';
import { useTransferSelection, FilePicker } from '@/features/sync';
import { PublishFilesDialog, PublishOptionsControl } from './publish-options-control';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function LiveSiteAction( {
	site,
	provider,
	remote,
	direction = 'push',
	disabled,
	publishing = false,
	forceEntireSite = false,
	confirmation,
	onConfirmPublish,
	onBack,
	returnFocus,
}: {
	site: SiteDetails;
	provider: SitesProviderId;
	remote: RemoteSite;
	direction?: 'push' | 'pull';
	disabled?: boolean;
	publishing?: boolean;
	forceEntireSite?: boolean;
	confirmation?: 'changes' | 'again';
	onConfirmPublish?: () => void;
	onBack?: () => void;
	returnFocus?: RefObject< HTMLButtonElement | null >;
} ) {
	const descriptor = getProviderSites( provider );
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const linkedPreview =
		confirmation && descriptor.previews
			? getLatestLinkedPreview( snapshots.data ?? [], site.id, Number( remote.id ) )
			: undefined;
	const status = usePreviewStatus( linkedPreview, !! linkedPreview?.versionId );
	const previewWarning =
		linkedPreview && status.data?.localChanged === true
			? getPreviewPublishWarning( linkedPreview )
			: undefined;
	const databaseWarningId = useId();
	const cancel = useRef< HTMLButtonElement >( null );
	const publishOptionsTrigger = useRef< HTMLButtonElement >( null );
	const [ confirmationView, setConfirmationView ] = useState<
		'confirm' | 'files' | 'review-files'
	>( 'confirm' );
	const selection = useTransferSelection(
		site,
		provider,
		remote,
		direction,
		true,
		forceEntireSite
	);
	const push = usePushSite();
	const pull = usePullSite();
	const issue = descriptor.issue?.( remote, direction );
	const canAdjustSelection = !! onConfirmPublish && descriptor.selective;
	const blocked =
		!! issue ||
		selection.loading ||
		( ! canAdjustSelection && ( selection.blocked || !! selection.error ) );
	const working = push.isPending || publishing;
	const checking = direction === 'push' && ! working && selection.loading;
	const submit = () => {
		const variables = { provider, siteId: site.id, remoteSiteId: remote.id };
		if ( direction === 'push' ) {
			push.mutate( {
				...variables,
				options: descriptor.selective ? selection.options.push : undefined,
			} );
			if ( confirmation ) onBack?.();
		} else {
			pull.mutate( {
				...variables,
				options: descriptor.selective ? selection.options.pull : undefined,
			} );
			onBack?.();
		}
	};
	const showDatabaseWarning =
		confirmation &&
		descriptor.selective &&
		selection.options.push.optionsToSync?.some(
			( option ) => option === 'all' || option === 'sqls'
		);
	const action = (
		<Button
			ref={ onConfirmPublish ? returnFocus : undefined }
			variant="accent"
			disabled={ disabled || blocked || working }
			loading={ working || checking }
			aria-describedby={ showDatabaseWarning ? databaseWarningId : undefined }
			onClick={ onConfirmPublish ?? submit }
		>
			{ direction === 'pull'
				? __( 'Replace selected content' )
				: working
				? __( 'Updating…' )
				: checking
				? __( 'Checking…' )
				: confirmation
				? __( 'Publish changes' )
				: onConfirmPublish
				? __( 'Update…' )
				: __( 'Update' ) }
		</Button>
	);
	const message =
		issue ??
		( direction === 'push'
			? selection.warning ??
			  ( selection.blocked ? __( 'Select something to publish.' ) : undefined )
			: undefined );
	const publishMessage = ! working && ! checking && ( message || selection.error ) && (
		<p role="status" className={ confirmation ? styles.changeStatus : styles.footerStatus }>
			{ message }
			{ selection.error && (
				<>
					{ ' ' }
					{ __( 'Publish options could not be loaded.' ) }{ ' ' }
					<Button variant="inline-link" size="inline" onClick={ selection.retry }>
						{ __( 'Try again' ) }
					</Button>
				</>
			) }
		</p>
	);
	const choices = [
		{ value: 'all', label: __( 'Entire site' ) },
		{ value: 'files', label: __( 'Files only' ) },
		{ value: 'content', label: __( 'Content and settings only' ) },
		{ value: 'custom', label: __( 'Choose files…' ) },
	] as const;
	// Pulled files are picked from the website's backups.
	const pullChoices = descriptor.hasBackups
		? choices
		: choices.filter( ( choice ) => choice.value !== 'custom' );
	if ( confirmation && confirmationView === 'files' )
		return (
			<PublishFilesDialog
				site={ site }
				provider={ provider }
				remote={ remote }
				selection={ selection }
				onClose={ () => setConfirmationView( 'review-files' ) }
			/>
		);
	if ( confirmation )
		return (
			<AlertDialog open onOpenChange={ ( open ) => ! open && onBack?.() }>
				<DialogContent
					layout="confirmation"
					initialFocus={ confirmationView === 'review-files' ? publishOptionsTrigger : cancel }
					finalFocus={ returnFocus }
				>
					<DialogHeader>
						<DialogTitle>
							{ confirmation === 'again' ? __( 'Publish again?' ) : __( 'Publish changes?' ) }
						</DialogTitle>
						<DialogDescription render={ <div /> }>
							<p>
								{ sprintf(
									/* translators: %s: the destination site's domain. */
									__( 'Publish to %s.' ),
									new URL( remote.url ).hostname
								) }
							</p>
							{ previewWarning && <p>{ previewWarning }</p> }
						</DialogDescription>
					</DialogHeader>
					{ descriptor.selective && (
						<div className={ styles.publishConfirmationOptions }>
							<PublishOptionsControl
								selection={ selection }
								disabled={ disabled || working }
								onChooseFiles={ () => setConfirmationView( 'files' ) }
								triggerRef={ publishOptionsTrigger }
							/>
							{ showDatabaseWarning && (
								<p id={ databaseWarningId }>
									{ __(
										'Publishing the database replaces changes made on the live site, including new comments or orders.'
									) }
								</p>
							) }
						</div>
					) }
					{ publishMessage }
					<DialogFooter>
						<Button ref={ cancel } variant="outline" onClick={ onBack }>
							{ __( 'Cancel' ) }
						</Button>
						{ action }
					</DialogFooter>
				</DialogContent>
			</AlertDialog>
		);
	if ( direction === 'push' )
		return (
			<div className={ styles.publishAction }>
				{ action }
				{ publishMessage }
			</div>
		);
	const hostname = new URL( remote.url ).hostname;
	return (
		<AlertDialog open onOpenChange={ ( open ) => ! open && onBack?.() }>
			<DialogContent layout="confirmation" initialFocus={ cancel } finalFocus={ false }>
				<DialogHeader>
					<DialogTitle>
						{ sprintf(
							/* translators: %s: the live site's domain. */
							__( 'Update local site from %s?' ),
							hostname
						) }
					</DialogTitle>
					<DialogDescription>
						{ sprintf(
							/* translators: %s: the live site's domain. */
							__(
								'This replaces the selected parts of your local site with what’s on %s. Any local changes in those parts will be lost.'
							),
							hostname
						) }
					</DialogDescription>
				</DialogHeader>
				{ descriptor.selective && (
					<>
						<Select
							value={ selection.scope }
							onValueChange={ ( value ) => value && selection.setScope( value ) }
							items={ pullChoices }
							disabled={ disabled || selection.loadingFiles }
						>
							<SelectTrigger aria-label={ __( 'What to replace' ) } fullWidth>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ pullChoices.map( ( choice ) => (
									<SelectItem
										key={ choice.value }
										value={ choice.value }
										disabled={ choice.value === 'custom' && selection.filesUnavailable }
									>
										{ choice.label }
									</SelectItem>
								) ) }
							</SelectContent>
						</Select>
						{ selection.scope === 'custom' && ! selection.filesUnavailable && (
							<FilePicker selection={ selection } />
						) }
					</>
				) }
				{ message && (
					<p role="alert" className={ styles.changeStatus }>
						{ message }
					</p>
				) }
				{ descriptor.hasBackups && selection.filesUnavailable && (
					<p role="status">
						{ selection.scope === 'custom'
							? __(
									'Your selected files are unavailable. Retry the backup check or choose another option to continue.'
							  )
							: __( 'Choosing individual files requires a backup of this website.' ) }
						{ selection.scope === 'custom' && (
							<>
								{ ' ' }
								<Button
									variant="inline-link"
									size="inline"
									disabled={ selection.loading }
									onClick={ selection.retry }
								>
									{ __( 'Try again' ) }
								</Button>
							</>
						) }
					</p>
				) }
				{ selection.error && (
					<p role="alert" className={ styles.changeStatus }>
						{ __( 'The transfer could not be completed. Please try again.' ) }
						<Button variant="inline-link" size="inline" onClick={ selection.retry }>
							{ __( 'Try again' ) }
						</Button>
					</p>
				) }
				<DialogFooter>
					<Button ref={ cancel } variant="outline" onClick={ onBack }>
						{ __( 'Cancel' ) }
					</Button>
					{ action }
				</DialogFooter>
			</DialogContent>
		</AlertDialog>
	);
}
