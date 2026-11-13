import { getLatestLinkedPreview, getPreviewPublishWarning } from '@studio/common/lib/snapshots';
import { getProviderSites, type RemoteSite, type SitesProviderId } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { useRef } from 'react';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { usePreviewStatus } from '@/data/queries/use-preview-status';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { usePushSite, usePullSite } from '@/data/queries/use-sync-site';
import { useTransferSelection, FilePicker } from '@/features/sync';
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
} from '@/lib/ui';
import styles from './style.module.css';
import type { SiteDetails } from '@/data/core';

export function LiveSiteAction( {
	site,
	provider,
	remote,
	direction = 'push',
	disabled,
	publishing = false,
	firstPublish = false,
	forceEntireSite = false,
	onBack,
	onPublishStarted,
}: {
	site: SiteDetails;
	provider: SitesProviderId;
	remote: RemoteSite;
	direction?: 'push' | 'pull';
	disabled?: boolean;
	publishing?: boolean;
	firstPublish?: boolean;
	forceEntireSite?: boolean;
	onBack?: () => void;
	onPublishStarted?: () => void;
} ) {
	const descriptor = getProviderSites( provider );
	const user = useAuthUser();
	const snapshots = useSnapshots( user.data?.id );
	const linkedPreview =
		direction === 'push' && descriptor.previews
			? getLatestLinkedPreview( snapshots.data ?? [], site.id, Number( remote.id ) )
			: undefined;
	const status = usePreviewStatus( linkedPreview, !! linkedPreview?.versionId );
	const previewWarning =
		linkedPreview && status.data?.localChanged === true
			? getPreviewPublishWarning( linkedPreview )
			: undefined;
	const cancel = useRef< HTMLButtonElement >( null );
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
	const issue = descriptor.issue( remote, direction );
	const blocked = !! issue || selection.blocked || selection.loading || !! selection.error;
	const working = push.isPending || publishing;
	const checking = direction === 'push' && ! working && selection.loading;
	const submit = () => {
		const variables = { provider, siteId: site.id, remoteSiteId: remote.id };
		if ( direction === 'push' ) {
			push.mutate( {
				...variables,
				options: descriptor.selective ? selection.options.push : undefined,
			} );
			onPublishStarted?.();
		} else {
			pull.mutate( {
				...variables,
				options: descriptor.selective ? selection.options.pull : undefined,
			} );
			onBack?.();
		}
	};
	const action = (
		<Button
			variant="accent"
			disabled={ disabled || blocked || working }
			loading={ working || checking }
			onClick={ submit }
		>
			{ direction === 'push'
				? working
					? __( 'Publishing…' )
					: checking
					? __( 'Checking…' )
					: firstPublish
					? __( 'Publish' )
					: __( 'Publish changes' )
				: __( 'Pull changes' ) }
		</Button>
	);
	const message =
		issue ??
		( direction === 'push'
			? selection.warning ??
			  ( selection.blocked ? __( 'Select something to publish.' ) : undefined )
			: undefined );
	const includesDatabase = selection.options.push.optionsToSync?.some(
		( option ) => option === 'all' || option === 'sqls'
	);
	const firstPushWarning =
		firstPublish && descriptor.selective && ! forceEntireSite && includesDatabase
			? __(
					'Publishing the database replaces anything that changed on your live WordPress, like new comments or orders.'
			  )
			: undefined;
	const choices = [
		{ value: 'all', label: __( 'Entire site' ) },
		{ value: 'files', label: __( 'Files only' ) },
		{ value: 'content', label: __( 'Content and settings only' ) },
		{ value: 'custom', label: __( 'Choose files…' ) },
	] as const;
	if ( direction === 'push' )
		return (
			<>
				{ ! working && ! checking && ( previewWarning || message || selection.error ) && (
					<p role="status" className={ styles.changeStatus }>
						{ previewWarning }
						{ previewWarning && ( message || selection.error ) ? ' ' : null }
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
				) }
				{ firstPushWarning && ! working && ! blocked && (
					<p className={ styles.changeStatus }>{ firstPushWarning }</p>
				) }
				{ action }
			</>
		);
	return (
		<AlertDialog open onOpenChange={ ( open ) => ! open && onBack?.() }>
			<DialogContent layout="confirmation" initialFocus={ cancel } finalFocus={ false }>
				<DialogHeader>
					<DialogTitle>{ __( 'Pull from live site?' ) }</DialogTitle>
					<DialogDescription>
						{ sprintf(
							/* translators: %s: the live site's domain. */
							__( 'Pull from %s.' ),
							new URL( remote.url ).hostname
						) }{ ' ' }
						{ __(
							"This replaces the selected parts of your local WordPress with the live site. Any changes you haven't pushed in those parts will be lost."
						) }
					</DialogDescription>
				</DialogHeader>
				{ descriptor.selective && (
					<>
						<Select
							value={ selection.scope }
							onValueChange={ ( value ) => value && selection.setScope( value ) }
							items={ choices }
							disabled={ disabled || selection.loadingFiles }
						>
							<SelectTrigger aria-label={ __( 'What to pull' ) } fullWidth>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ choices.map( ( choice ) => (
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
						{ selection.scope === 'custom' && <FilePicker selection={ selection } /> }
					</>
				) }
				{ message && (
					<p role="alert" className={ styles.changeStatus }>
						{ message }
					</p>
				) }
				{ selection.filesUnavailable && (
					<p>{ __( 'Choosing individual files requires a backup of this website.' ) }</p>
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
