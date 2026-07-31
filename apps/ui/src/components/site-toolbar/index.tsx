import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Button, Tooltip } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { SiteStatusButton } from '@/components/site-status-button';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useLogin } from '@/data/queries/use-auth-user';
import { useConnectedWpcomSites } from '@/data/queries/use-connected-wpcom-sites';
import { PUBLISH_PREVIEW_MUTATION_KEY } from '@/data/queries/use-preview-site';
import { useIsSiteStarting, useIsSiteStopping } from '@/data/queries/use-sites';
import {
	PULL_FROM_LIVE_MUTATION_KEY,
	PUSH_TO_LIVE_MUTATION_KEY,
	usePullSiteFromLive,
	usePushSiteToLive,
} from '@/data/queries/use-sync-site';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useSidebarCollapsed } from '@/hooks/use-sidebar-collapsed';
import { getSiteDisplayUrl, getSiteUrl } from '@/lib/get-site-url';
import { ActionButton } from './action-button';
import { deriveToolbarState } from './derive-toolbar-state';
import { PublishSiteDialog } from './publish-site-dialog';
import { ShareDialog } from './share-dialog';
import styles from './style.module.css';
import { SyncDialog } from './sync-dialog';
import { ensureProtocol, sortConnections } from './utils';
import type { SiteDetails, SyncSite } from '@/data/core';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

interface SiteToolbarProps {
	site: SiteDetails;
	className?: string;
}

// Counts in-flight push/pull mutations for this site across hook instances, so
// a push kicked off from the publish-picker flow still reads as busy here.
function useIsSiteSyncing( siteId: string ): { push: boolean; pull: boolean } {
	const push =
		useIsMutating( {
			mutationKey: PUSH_TO_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	const pull =
		useIsMutating( {
			mutationKey: PULL_FROM_LIVE_MUTATION_KEY,
			predicate: ( mutation ) =>
				( mutation.state.variables as { siteId: string } | undefined )?.siteId === siteId,
		} ) > 0;
	return { push, pull };
}

/**
 * The site's permanent header: who you're working on and what state it's in on
 * the left, one status pill and one primary action on the right. Replaces the
 * old site dropdown, whose actions were hidden behind a trigger that read as a
 * status indicator.
 */
export function SiteToolbar( { site, className }: SiteToolbarProps ) {
	const connector = useConnector();
	const { enabled: agenticEnabled, reason: agenticReason } = useAgenticFeatures();
	// The sidebar's site rows already carry a run-state dot for every site,
	// including this one. Showing a second one in the header only earns its
	// place once the sidebar is out of view.
	const showRunState = useSidebarCollapsed();
	const login = useLogin();
	const [ publishOpen, setPublishOpen ] = useState( false );
	const [ syncOpen, setSyncOpen ] = useState( false );
	const [ shareOpen, setShareOpen ] = useState( false );

	const isStarting = useIsSiteStarting( site.id );
	const isStopping = useIsSiteStopping( site.id );
	const activity = useSiteSyncActivity( site.id );
	const { data: connectedSites } = useConnectedWpcomSites( site.id );
	const targets = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );

	const pushSiteToLive = usePushSiteToLive();
	const pullSiteFromLive = usePullSiteFromLive();
	const { push: isPushPending, pull: isPullPending } = useIsSiteSyncing( site.id );
	// Counted rather than read off a local mutation: previews are published
	// from the site's own Previews tab, which owns its hook instance.
	const isPreviewPending = useIsMutating( { mutationKey: PUBLISH_PREVIEW_MUTATION_KEY } ) > 0;
	// Preview / push / pull all mutate the same local site; running them
	// concurrently would wedge the site runtime.
	const isSyncing = isPreviewPending || isPushPending || isPullPending;

	const { actions } = deriveToolbarState( {
		activity,
		agenticEnabled,
		agenticReason,
		connections: targets,
		isSyncing,
		siteRunning: site.running,
	} );

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const runSync = (
		direction: 'push' | 'pull',
		target: SyncSite,
		options: PushSyncOptions | PullSyncOptions | undefined
	) => {
		if ( isSyncing ) {
			return;
		}
		if ( direction === 'pull' ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: target.id, options } );
			return;
		}
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: target.id, options },
			{ onSuccess: () => openExternal( ensureProtocol( target.url ) ) }
		);
	};

	const localSiteUrl = getSiteUrl( site );
	const localSiteLabel = isStopping
		? __( 'Stopping…' )
		: isStarting
		? __( 'Starting…' )
		: getSiteDisplayUrl( site );
	const canOpenLocalSite = site.running && ! isStopping;

	return (
		<div className={ clsx( styles.toolbar, className ) }>
			<div className={ styles.identity }>
				<SiteIcon
					className={ styles.siteIcon }
					seed={ `${ site.id }:${ site.name }:${ site.path }` }
					imageSrc={ site.siteIcon }
				/>
				<div className={ styles.identityText }>
					<span className={ styles.siteName }>{ site.name }</span>
					<span
						className={ clsx(
							styles.siteStatusRow,
							showRunState && styles.siteStatusRowWithButton
						) }
					>
						{ showRunState ? (
							<SiteStatusButton
								site={ site }
								isStarting={ isStarting }
								isStopping={ isStopping }
								className={ styles.siteStatusButton }
							/>
						) : null }
						{ canOpenLocalSite ? (
							<Tooltip.Root>
								<Tooltip.Trigger
									render={
										<button
											type="button"
											className={ styles.siteUrl }
											onClick={ () => openExternal( localSiteUrl ) }
										>
											<span>{ localSiteLabel }</span>
											<Icon
												className={ styles.siteUrlIcon }
												icon={ external }
												size={ 12 }
												aria-hidden="true"
											/>
										</button>
									}
								/>
								<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
									{ __( 'Open Studio site in your browser' ) }
								</Tooltip.Popup>
							</Tooltip.Root>
						) : (
							<span className={ styles.siteUrlStatic }>{ localSiteLabel }</span>
						) }
					</span>
				</div>
			</div>

			<div className={ styles.actions }>
				{ /* Sharing isn't a sync: it publishes a throwaway copy, so it sits
				     outside the primary action rather than inside its panel. */ }
				<Tooltip.Root>
					<Tooltip.Trigger
						render={
							<Button
								variant="minimal"
								tone="neutral"
								size="small"
								className={ styles.action }
								disabled={ ! agenticEnabled }
								onClick={ () => setShareOpen( true ) }
							>
								{ __( 'Share' ) }
							</Button>
						}
					/>
					<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
						{ agenticEnabled
							? __( 'Publish a preview link' )
							: __( 'Go online to share a preview.' ) }
					</Tooltip.Popup>
				</Tooltip.Root>

				{ actions.map( ( action ) =>
					action.id === 'publish' ? (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => setPublishOpen( true ) }
						/>
					) : action.id === 'login' ? (
						<ActionButton key={ action.id } action={ action } onClick={ () => login.mutate() } />
					) : (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => targets.length > 0 && setSyncOpen( true ) }
						/>
					)
				) }
			</div>

			{ shareOpen ? <ShareDialog site={ site } open onOpenChange={ setShareOpen } /> : null }

			{ targets.length > 0 ? (
				<SyncDialog
					siteId={ site.id }
					connections={ targets }
					open={ syncOpen }
					onOpenChange={ setSyncOpen }
					onRun={ runSync }
				/>
			) : null }

			{ /* Mounted only while open: it loads the account's sites on mount. */ }
			{ publishOpen ? (
				<PublishSiteDialog site={ site } open onOpenChange={ setPublishOpen } />
			) : null }
		</div>
	);
}
