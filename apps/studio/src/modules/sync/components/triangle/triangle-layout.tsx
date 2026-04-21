import { Tooltip } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	useGetConnectedSitesForLocalSiteQuery,
	connectedSitesActions,
} from 'src/stores/sync/connected-sites';
import {
	usePullFromStagingMutation,
	usePushToStagingMutation,
} from 'src/stores/sync/staging-site-api';
import { syncOperationsSelectors } from 'src/stores/sync/sync-operations-slice';
import { useStagingProvisioning } from '../../hooks/use-staging-provisioning';
import { useSyncActions } from '../../hooks/use-sync-actions';
import { deriveSlotAssignments } from '../../lib/slot-derivation';
import ActivityRegion, {
	type SetupPanelState,
} from '../activity-region/activity-region';
import { ArchivedConnections } from './archived-connections';
import { computeEdgeGeometry, type Point } from './edge-geometry';
import { EnvironmentColumn } from './environment-column';
import { ConnectProductionCard, CreateStagingCard } from './placeholder-card';
import { ProvisioningColumn } from './provisioning-column';
import { SyncGutter } from './sync-gutter';
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

/**
 * Renders the SVG `<path>` for an edge. Must be placed inside an `<svg>` element.
 */
function EdgePath( {
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
		<path
			d={ geom.pathD }
			className={ `fill-none stroke-[1.5] [stroke-linecap:round] ${ pathClass } ${ dashClass }` }
		/>
	);
}

/**
 * Renders the push/pull HTML buttons for an edge. Must be placed as an HTML
 * sibling of the SVG, not inside it (SVG only accepts SVG children).
 */
function EdgeButtons( {
	anchors,
	state,
}: {
	anchors: { a: Point; b: Point } | null;
	state: EdgeState;
} ) {
	if ( ! anchors ) return null;
	const geom = computeEdgeGeometry( anchors.a, anchors.b, ARROW_OFFSET );
	return (
		<>
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

	const productionSlot = production ? (
		<EnvironmentColumn
			kind="remote"
			label="Production"
			site={ production }
			orientation="landscape"
		/>
	) : (
		<ConnectProductionCard onClick={ openConnectModal } />
	);

	const stagingSlot = staging ? (
		<EnvironmentColumn kind="remote" label="Staging" site={ staging } orientation="landscape" />
	) : provisioning.state === 'idle' ? (
		<CreateStagingCard onClick={ provisioning.start } />
	) : (
		<ProvisioningColumn
			state={ provisioning.state }
			error={ provisioning.error }
			onRetry={ provisioning.start }
		/>
	);

	const containerRef = useRef< HTMLDivElement >( null );
	const localRef = useRef< HTMLDivElement >( null );
	const productionRef = useRef< HTMLDivElement >( null );
	const stagingRef = useRef< HTMLDivElement >( null );

	const anchors = useEdgeAnchors( containerRef, {
		local: localRef,
		production: productionRef,
		staging: stagingRef,
	} );
	const isNarrow = useIsNarrow( containerRef );

	const localProdActive = useActiveDirection( selectedSite.id, production?.id );
	const localStagingActive = useActiveDirection( selectedSite.id, staging?.id );

	const localProdState: EdgeState = {
		activeDirection: localProdActive,
		muted: ! production,
		onPush: production ? () => syncActions.push( production ) : undefined,
		onPull: production ? () => syncActions.pull( production ) : undefined,
		pushLabel: __( 'Push to Production' ),
		pullLabel: __( 'Pull from Production' ),
	};

	const localStagingState: EdgeState = {
		activeDirection: localStagingActive,
		muted: ! staging,
		onPush: staging ? () => syncActions.push( staging ) : undefined,
		onPull: staging ? () => syncActions.pull( staging ) : undefined,
		pushLabel: __( 'Push to Staging' ),
		pullLabel: __( 'Pull from Staging' ),
	};

	const setupPanel: SetupPanelState | null = syncActions.pendingSyncTarget
		? {
				localSite: selectedSite,
				remoteSite: syncActions.pendingSyncTarget.connectedSite,
				type: syncActions.pendingSyncTarget.direction,
				onPush: syncActions.commitPush,
				onPull: syncActions.commitPull,
		  }
		: null;

	const activityRegion = (
		<div className="sticky bottom-0 z-10 bg-frame px-6 pb-6 pt-3 empty:hidden">
			<ActivityRegion
				localSiteId={ selectedSite.id }
				setupPanel={ setupPanel }
				onCloseSetup={ syncActions.closeDialog }
			/>
		</div>
	);

	const prodStagingState: EdgeState = {
		activeDirection: null,
		muted: ! production || ! staging,
		onPush:
			production && staging
				? () =>
						void pushToStaging( {
							productionSiteId: production.id,
							stagingSiteId: staging.id,
							options: DEFAULT_STAGING_OPTIONS,
						} )
				: undefined,
		onPull:
			production && staging
				? () =>
						void pullFromStaging( {
							productionSiteId: production.id,
							stagingSiteId: staging.id,
							options: DEFAULT_STAGING_OPTIONS,
							allowWooSync: false,
						} )
				: undefined,
		pushLabel: __( 'Copy Production to Staging' ),
		pullLabel: __( 'Copy Staging to Production' ),
	};

	if ( isNarrow ) {
		return (
			<>
			<div ref={ containerRef } className="flex flex-col gap-3 p-6 pb-0">
				<div ref={ localRef }>
					<EnvironmentColumn
						kind="local"
						label="Local"
						orientation="landscape"
						localSiteId={ selectedSite.id }
						siteName={ selectedSite.name }
						siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
						isRunning={ selectedSite.running }
					/>
				</div>
				{ production && (
					<SyncGutter
						from={ { kind: 'local', label: 'Local' } }
						to={ { kind: 'remote', label: 'Production' } }
						lastPushTimestamp={ production.lastPushTimestamp }
						lastPullTimestamp={ production.lastPullTimestamp }
						pushArrow="↓"
						pullArrow="↑"
						onPush={ () => syncActions.push( production ) }
						onPull={ () => syncActions.pull( production ) }
					/>
				) }
				<div ref={ productionRef }>{ productionSlot }</div>
				{ staging && (
					<SyncGutter
						from={ { kind: 'local', label: 'Local' } }
						to={ { kind: 'remote', label: 'Staging' } }
						lastPushTimestamp={ staging.lastPushTimestamp }
						lastPullTimestamp={ staging.lastPullTimestamp }
						pushArrow="↓"
						pullArrow="↑"
						onPush={ () => syncActions.push( staging ) }
						onPull={ () => syncActions.pull( staging ) }
					/>
				) }
				<div ref={ stagingRef }>{ stagingSlot }</div>
				<ArchivedConnections
					localSiteId={ selectedSite.id }
					archived={ archived }
					isProductionOpen={ ! production }
					isStagingOpen={ ! staging }
				/>
			</div>
			{ activityRegion }
			</>
		);
	}

	return (
		<>
		<div
			ref={ containerRef }
			className="relative grid grid-cols-[1fr_1fr] gap-x-12 p-6 pb-0"
			style={ { gridTemplateRows: 'auto 120px auto' } }
		>
			<svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
				<EdgePath anchors={ anchors.localProd } state={ localProdState } />
				<EdgePath anchors={ anchors.localStaging } state={ localStagingState } />
				<EdgePath anchors={ anchors.prodStaging } state={ prodStagingState } />
			</svg>
			<EdgeButtons anchors={ anchors.localProd } state={ localProdState } />
			<EdgeButtons anchors={ anchors.localStaging } state={ localStagingState } />
			<EdgeButtons anchors={ anchors.prodStaging } state={ prodStagingState } />

			<div ref={ localRef } className="col-span-2 row-start-1 justify-self-center">
				<EnvironmentColumn
					kind="local"
					label="Local"
					orientation="landscape"
					localSiteId={ selectedSite.id }
					siteName={ selectedSite.name }
					siteUrl={ selectedSite.running ? `http://localhost:${ selectedSite.port }` : '' }
					isRunning={ selectedSite.running }
				/>
			</div>

			<div ref={ productionRef } className="col-start-1 row-start-3 justify-self-center">
				{ productionSlot }
			</div>
			<div ref={ stagingRef } className="col-start-2 row-start-3 justify-self-center">
				{ stagingSlot }
			</div>

			<div className="col-span-2 row-start-3 mt-4">
				<ArchivedConnections
					localSiteId={ selectedSite.id }
					archived={ archived }
					isProductionOpen={ ! production }
					isStagingOpen={ ! staging }
				/>
			</div>

		</div>
		{ activityRegion }
		</>
	);
}
