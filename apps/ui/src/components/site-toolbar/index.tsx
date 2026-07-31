import { useIsMutating } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { external, Icon } from '@wordpress/icons';
import { Tooltip } from '@wordpress/ui';
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
import { ToolbarTweaksPanel, useToolbarPreview } from './dev-tweaks';
import { PublishSiteDialog } from './publish-site-dialog';
import styles from './style.module.css';
import { SyncButton } from './sync-button';
import { ensureProtocol, sortConnections } from './utils';
import type { ToolbarActionId } from './derive-toolbar-state';
import type { SiteDetails, SyncSite } from '@/data/core';

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

	// The preview hook returns the real derived state unless the dev tweaks
	// panel is driving. Temporary — see `./dev-tweaks`.
	const preview = useToolbarPreview(
		{
			activity,
			agenticEnabled,
			agenticReason,
			connections: targets,
			isSyncing,
			siteRunning: site.running,
		},
		{ running: site.running, isStarting, isStopping }
	);
	const { actions } = preview.state;
	const previewSite =
		preview.run.running === site.running ? site : { ...site, running: preview.run.running };
	// While the panel drives, its synthetic connections stand in for the real
	// set so the buttons don't offer targets the fake state doesn't have.
	const syncTargets = preview.active ? preview.connections : targets;

	const openExternal = ( url: string ) => {
		void connector.openExternalUrl( url );
	};

	const runSync = ( action: ToolbarActionId, target: SyncSite ) => {
		// While the tweaks panel drives the toolbar, the state on screen is a
		// picture — don't start real work from it.
		if ( isSyncing || preview.active ) {
			return;
		}
		if ( action === 'pull' ) {
			pullSiteFromLive.mutate( { siteId: site.id, remoteSiteId: target.id } );
			return;
		}
		pushSiteToLive.mutate(
			{ siteId: site.id, remoteSiteId: target.id },
			{ onSuccess: () => openExternal( ensureProtocol( target.url ) ) }
		);
	};

	const localSiteUrl = getSiteUrl( site );
	const localSiteLabel = preview.run.isStopping
		? __( 'Stopping…' )
		: preview.run.isStarting
		? __( 'Starting…' )
		: getSiteDisplayUrl( site );
	const canOpenLocalSite = preview.run.running && ! preview.run.isStopping;

	return (
		<div
			className={ clsx( styles.toolbar, preview.active && styles.toolbarPreviewing, className ) }
		>
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
								site={ previewSite }
								isStarting={ preview.run.isStarting }
								isStopping={ preview.run.isStopping }
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
				{ /* Both directions are on screen at once, so neither is a mode that
				     can be left pointing the wrong way. Each button names its own
				     target when the site has more than one connection. */ }
				{ actions.map( ( action ) =>
					action.id === 'publish' ? (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => ! preview.active && setPublishOpen( true ) }
						/>
					) : action.id === 'login' ? (
						<ActionButton
							key={ action.id }
							action={ action }
							onClick={ () => ! preview.active && login.mutate() }
						/>
					) : (
						<SyncButton
							key={ action.id }
							action={ action }
							targets={ syncTargets }
							onRun={ ( target ) => runSync( action.id, target ) }
						/>
					)
				) }
			</div>

			{ /* Mounted only while open: it loads the account's sites on mount. */ }
			{ publishOpen ? (
				<PublishSiteDialog site={ site } open onOpenChange={ setPublishOpen } />
			) : null }

			<ToolbarTweaksPanel />
		</div>
	);
}
