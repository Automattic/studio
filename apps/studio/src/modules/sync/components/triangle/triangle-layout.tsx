import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync/sync-operations-slice';
import {
	useGetConnectedSitesForLocalSiteQuery,
	connectedSitesActions,
} from 'src/stores/sync/connected-sites';
import {
	usePullFromStagingMutation,
	usePushToStagingMutation,
} from 'src/stores/sync/staging-site-api';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { useSyncActions } from '../../hooks/use-sync-actions';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import { SyncDialog } from '../sync-dialog';
import { ArchivedConnections } from './archived-connections';
import { EnvironmentColumn } from './environment-column';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { SyncGutter } from './sync-gutter';
import { computeEdgeGeometry, type Point } from './edge-geometry';
import type { SyncOption } from '@studio/common/types/sync';

type CardRefs = {
	local: React.RefObject< HTMLDivElement >;
	production: React.RefObject< HTMLDivElement >;
	staging: React.RefObject< HTMLDivElement >;
};

type Anchors = {
	localProd: { a: Point; b: Point } | null;
	localStaging: { a: Point; b: Point } | null;
	prodStaging: { a: Point; b: Point } | null;
};

const EMPTY_ANCHORS: Anchors = { localProd: null, localStaging: null, prodStaging: null };

function anchorPoint(
	card: HTMLDivElement | null,
	container: HTMLDivElement | null,
	side: 'bottom-left' | 'bottom-right' | 'top' | 'left' | 'right',
	inset = 24
): Point | null {
	if ( ! card || ! container ) return null;
	const c = container.getBoundingClientRect();
	const r = card.getBoundingClientRect();
	switch ( side ) {
		case 'bottom-left':
			return { x: r.left + inset - c.left, y: r.bottom - c.top };
		case 'bottom-right':
			return { x: r.right - inset - c.left, y: r.bottom - c.top };
		case 'top':
			return { x: r.left + r.width / 2 - c.left, y: r.top - c.top };
		case 'left':
			return { x: r.left - c.left, y: r.top + r.height / 2 - c.top };
		case 'right':
			return { x: r.right - c.left, y: r.top + r.height / 2 - c.top };
	}
}

function useEdgeAnchors(
	containerRef: React.RefObject< HTMLDivElement >,
	refs: CardRefs
): Anchors {
	const [ anchors, setAnchors ] = useState< Anchors >( EMPTY_ANCHORS );

	useLayoutEffect( () => {
		const recompute = () => {
			const container = containerRef.current;
			const local = refs.local.current;
			const prod = refs.production.current;
			const staging = refs.staging.current;
			const localBL = anchorPoint( local, container, 'bottom-left' );
			const localBR = anchorPoint( local, container, 'bottom-right' );
			const prodTop = anchorPoint( prod, container, 'top' );
			const prodRight = anchorPoint( prod, container, 'right' );
			const stagingTop = anchorPoint( staging, container, 'top' );
			const stagingLeft = anchorPoint( staging, container, 'left' );
			setAnchors( {
				localProd: localBL && prodTop ? { a: localBL, b: prodTop } : null,
				localStaging: localBR && stagingTop ? { a: localBR, b: stagingTop } : null,
				prodStaging: prodRight && stagingLeft ? { a: prodRight, b: stagingLeft } : null,
			} );
		};

		recompute();
		const observed = [
			containerRef.current,
			refs.local.current,
			refs.production.current,
			refs.staging.current,
		].filter( ( el ): el is HTMLDivElement => el !== null );
		const ro = new ResizeObserver( recompute );
		observed.forEach( ( el ) => ro.observe( el ) );
		window.addEventListener( 'resize', recompute );
		return () => {
			ro.disconnect();
			window.removeEventListener( 'resize', recompute );
		};
	}, [ containerRef, refs.local, refs.production, refs.staging ] );

	return anchors;
}

type EdgeState = {
	activeDirection: 'push' | 'pull' | null;
	muted: boolean;
	onPush?: () => void;
	onPull?: () => void;
	pushLabel: string;
	pullLabel: string;
};

const ARROW_OFFSET = 22;

function Edge( {
	anchors,
	state,
}: {
	anchors: { a: Point; b: Point } | null;
	state: EdgeState;
} ) {
	if ( ! anchors ) return null;
	const geom = computeEdgeGeometry( anchors.a, anchors.b, ARROW_OFFSET );
	const pathClass = state.activeDirection
		? state.activeDirection === 'push'
			? 'stroke-frame-theme animate-edge-march'
			: 'stroke-frame-theme animate-edge-march-reverse'
		: state.muted
		? 'stroke-frame-border opacity-40'
		: 'stroke-frame-border';
	const dashClass = state.activeDirection
		? '[stroke-dasharray:6_6]'
		: state.muted
		? '[stroke-dasharray:4_4]'
		: '';
	return (
		<>
			<path
				d={ geom.pathD }
				className={ `fill-none stroke-[1.5] [stroke-linecap:round] ${ pathClass } ${ dashClass }` }
			/>
			<ArrowButton
				center={ geom.pushCenter }
				angleDeg={ geom.angleDeg }
				glyph="↓"
				label={ state.pushLabel }
				active={ state.activeDirection === 'push' }
				onClick={ state.onPush }
			/>
			<ArrowButton
				center={ geom.pullCenter }
				angleDeg={ geom.angleDeg }
				glyph="↑"
				label={ state.pullLabel }
				active={ state.activeDirection === 'pull' }
				onClick={ state.onPull }
			/>
		</>
	);
}

function ArrowButton( {
	center,
	angleDeg,
	glyph,
	label,
	active,
	onClick,
}: {
	center: Point;
	angleDeg: number;
	glyph: '↑' | '↓';
	label: string;
	active: boolean;
	onClick?: () => void;
} ) {
	const disabled = ! onClick;
	return (
		<Tooltip text={ label }>
			<button
				type="button"
				aria-label={ label }
				onClick={ onClick }
				disabled={ disabled }
				className={ `pointer-events-auto absolute grid h-7 w-7 place-items-center rounded-md border ${
					active
						? 'border-frame-theme text-frame-theme'
						: 'border-frame-border bg-frame-surface text-frame-text hover:bg-frame-surface-alt hover:border-frame-text-secondary'
				} ${ disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer' }` }
				style={ {
					left: `${ center.x }px`,
					top: `${ center.y }px`,
					transform: `translate(-50%, -50%) rotate(${ angleDeg }deg)`,
				} }
			>
				{ glyph }
			</button>
		</Tooltip>
	);
}

/**
 * Returns 'push' | 'pull' | null for the active sync between `localSiteId` and the
 * given remote site. Reads from the `syncOperations` slice via memoized selectors.
 */
function useActiveDirection(
	localSiteId: string,
	remoteSiteId: number | undefined
): 'push' | 'pull' | null {
	const isPushing = useRootSelector( ( state ) =>
		remoteSiteId !== undefined
			? syncOperationsSelectors.selectIsSiteIdPushing( localSiteId, remoteSiteId )( state )
			: false
	);
	const isPulling = useRootSelector( ( state ) =>
		remoteSiteId !== undefined
			? syncOperationsSelectors.selectIsSiteIdPulling( localSiteId, remoteSiteId )( state )
			: false
	);
	if ( isPushing ) return 'push';
	if ( isPulling ) return 'pull';
	return null;
}

const NARROW_BREAKPOINT = 720;

function useIsNarrow( containerRef: React.RefObject< HTMLDivElement > ): boolean {
	const [ narrow, setNarrow ] = useState( false );
	useEffect( () => {
		const el = containerRef.current;
		if ( ! el ) return;
		const check = () => setNarrow( el.clientWidth < NARROW_BREAKPOINT );
		check();
		const ro = new ResizeObserver( check );
		ro.observe( el );
		return () => ro.disconnect();
	}, [ containerRef ] );
	return narrow;
}

type Props = {
	selectedSite: SiteDetails;
};

const DEFAULT_STAGING_OPTIONS: SyncOption[] = [
	'sqls',
	'uploads',
	'plugins',
	'themes',
	'contents',
];

export function TriangleLayout( { selectedSite }: Props ) {
	const dispatch = useAppDispatch();
	const { user } = useAuth();
	const { data: sites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const { production, staging, archived } = deriveSlotAssignments( sites );
	const provisioning = useStagingProvisioning( {
		productionSiteId: production?.id ?? 0,
		localSiteId: selectedSite.id,
	} );
	const syncActions = useSyncActions( selectedSite );
	const [ pushToStaging ] = usePushToStagingMutation();
	const [ pullFromStaging ] = usePullFromStagingMutation();

	const openConnectModal = () => dispatch( connectedSitesActions.openModal( 'connect' ) );

	const renderLocalSyncHub = ( target: 'production' | 'staging' ) => {
		const site = target === 'production' ? production : staging;
		if ( ! site ) return <div />;
		return (
			<SyncGutter
				from={ { kind: 'local', label: 'Local' } }
				to={ { kind: 'remote', label: target === 'production' ? 'Production' : 'Staging' } }
				lastPushTimestamp={ site.lastPushTimestamp }
				lastPullTimestamp={ site.lastPullTimestamp }
				// Local is above the bottom remotes: Push goes down toward the remote,
				// Pull comes up toward Local.
				pushArrow="↓"
				pullArrow="↑"
				onPush={ () => syncActions.push( site ) }
				onPull={ () => syncActions.pull( site ) }
			/>
		);
	};

	const productionSlot = production ? (
		<EnvironmentColumn
			kind="remote"
			label="Production"
			site={ production }
			orientation="portrait"
		/>
	) : (
		<ConnectProductionCard onClick={ openConnectModal } />
	);

	const stagingSlot = staging ? (
		<EnvironmentColumn kind="remote" label="Staging" site={ staging } orientation="portrait" />
	) : provisioning.state === 'idle' ? (
		<CreateStagingCard onClick={ provisioning.start } />
	) : (
		<ProvisioningColumn
			state={ provisioning.state }
			error={ provisioning.error }
			onRetry={ provisioning.start }
		/>
	);

	return (
		<div className="flex flex-col gap-3 p-6">
			{ /*
			  Triangle layout: Local at top; Production (left) and Staging (right) below.
			  All three cards share the portrait layout. Sync hubs sit between Local and
			  each bottom card, plus a compact arrow pair between Prod and Staging.
			*/ }
			<EnvironmentColumn
				kind="local"
				label="Local"
				orientation="portrait"
				localSiteId={ selectedSite.id }
				siteName={ selectedSite.name }
				siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
				isRunning={ selectedSite.running }
			/>

			{ ( production || staging ) && (
				<div className="grid grid-cols-[1fr_auto_1fr] items-start gap-4">
					<div className="flex justify-center">
						{ production ? renderLocalSyncHub( 'production' ) : null }
					</div>
					<div />
					<div className="flex justify-center">
						{ staging ? renderLocalSyncHub( 'staging' ) : null }
					</div>
				</div>
			) }

			<div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
				{ productionSlot }
				<div className="flex flex-col items-center justify-center gap-2">
					{ production && staging ? (
						<>
							<Tooltip text={ __( 'Copy Production to Staging' ) }>
								<Button
									variant="secondary"
									aria-label={ __( 'Copy Production to Staging' ) }
									onClick={ () => {
										void pushToStaging( {
											productionSiteId: production.id,
											stagingSiteId: staging.id,
											options: DEFAULT_STAGING_OPTIONS,
										} );
									} }
								>
									→
								</Button>
							</Tooltip>
							<Tooltip text={ __( 'Copy Staging to Production' ) }>
								<Button
									variant="secondary"
									aria-label={ __( 'Copy Staging to Production' ) }
									onClick={ () => {
										void pullFromStaging( {
											productionSiteId: production.id,
											stagingSiteId: staging.id,
											options: DEFAULT_STAGING_OPTIONS,
											allowWooSync: false,
										} );
									} }
								>
									←
								</Button>
							</Tooltip>
						</>
					) : null }
				</div>
				{ stagingSlot }
			</div>

			<ArchivedConnections
				localSiteId={ selectedSite.id }
				archived={ archived }
				isProductionOpen={ ! production }
				isStagingOpen={ ! staging }
			/>

			{ syncActions.pendingSyncTarget && (
				<SyncDialog
					type={ syncActions.pendingSyncTarget.direction }
					localSite={ selectedSite }
					remoteSite={ syncActions.pendingSyncTarget.connectedSite }
					onPush={ syncActions.commitPush }
					onPull={ syncActions.commitPull }
					onRequestClose={ syncActions.closeDialog }
				/>
			) }
		</div>
	);
}
