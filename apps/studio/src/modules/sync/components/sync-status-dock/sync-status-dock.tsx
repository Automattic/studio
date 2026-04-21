import { Button, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { canCancelPull, canCancelPush } from 'src/lib/active-sync-operations';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync/sync-operations-slice';
import type { SyncBackupState, SyncPushState } from 'src/stores/sync/sync-operations-slice';

type DockItem =
	| { kind: 'push'; stateId: string; state: SyncPushState }
	| { kind: 'pull'; stateId: string; state: SyncBackupState };

function ProgressBar( { progress, failed }: { progress: number; failed: boolean } ) {
	return (
		<div className="h-1 w-full overflow-hidden rounded-full bg-frame-border">
			<div
				className={ `h-full rounded-full transition-all ${
					failed ? 'bg-frame-error' : 'bg-frame-theme'
				}` }
				style={ { width: `${ failed ? 100 : progress }%` } }
			/>
		</div>
	);
}

function SyncRow( { item }: { item: DockItem } ) {
	const dispatch = useAppDispatch();
	const { getPushUploadPercentage, getPushUploadMessage } = useSyncStatesProgressInfo();

	const { status, selectedSite, remoteSiteUrl } = item.state;
	const isFailed = status.key === 'failed';
	const isPush = item.kind === 'push';

	const remoteLabel = remoteSiteUrl
		? getHostnameFromUrl( remoteSiteUrl )
		: isPush
		? __( 'Production' )
		: __( 'Production' );
	const directionLabel = isPush ? __( 'Pushing' ) : __( 'Pulling' );
	const arrow = isPush ? '→' : '←';

	let message = status.message;
	if ( isPush && item.kind === 'push' ) {
		const uploadPct = getPushUploadPercentage( item.state.status.key, item.state.uploadProgress );
		message = getPushUploadMessage( status.message, uploadPct );
	}

	const isCancellable = isPush
		? canCancelPush( ( item.state as SyncPushState ).status.key )
		: canCancelPull( ( item.state as SyncBackupState ).status.key );

	const selectedSiteId = selectedSite.id;
	const remoteSiteId = item.state.remoteSiteId;

	function handleCancel() {
		if ( isPush ) {
			void dispatch( syncOperationsThunks.cancelPush( { selectedSiteId, remoteSiteId } ) );
		} else {
			void dispatch( syncOperationsThunks.cancelPull( { selectedSiteId, remoteSiteId } ) );
		}
	}

	function handleDismiss() {
		if ( isPush ) {
			dispatch( syncOperationsActions.clearPushState( { selectedSiteId, remoteSiteId } ) );
		} else {
			dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
		}
	}

	return (
		<div className="flex flex-col gap-2 px-4 py-3">
			{ /* Heading line */ }
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="a8c-subtitle-small truncate font-semibold text-frame-text">
						{ selectedSite.name }
					</span>
					<span className="shrink-0 text-frame-text-secondary">{ arrow }</span>
					<span className="truncate text-sm text-frame-text-secondary">{ remoteLabel }</span>
				</div>
				<span className="shrink-0 text-xs text-frame-text-secondary">{ directionLabel }</span>
			</div>

			{ /* Progress bar */ }
			<ProgressBar progress={ status.progress } failed={ isFailed } />

			{ /* Status line */ }
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-1.5">
					{ ! isFailed && <Spinner className="!m-0 !h-4 !w-4 shrink-0" /> }
					<span
						className={ `truncate text-xs ${
							isFailed ? 'text-frame-error' : 'text-frame-text-secondary'
						}` }
					>
						{ isFailed ? status.message || __( 'Sync failed' ) : message }
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{ isFailed ? (
						<Button size="small" variant="secondary" onClick={ handleDismiss }>
							{ __( 'Dismiss' ) }
						</Button>
					) : (
						<Button
							size="small"
							variant="secondary"
							onClick={ handleCancel }
							disabled={ ! isCancellable }
						>
							{ __( 'Cancel' ) }
						</Button>
					) }
				</div>
			</div>
		</div>
	);
}

export function SyncStatusDock(): JSX.Element | null {
	const pullStates = useRootSelector( syncOperationsSelectors.selectPullStates );
	const pushStates = useRootSelector( syncOperationsSelectors.selectPushStates );

	const items: DockItem[] = [];

	for ( const [ stateId, state ] of Object.entries( pushStates ) ) {
		const key = state.status.key;
		if ( key !== 'finished' && key !== 'cancelled' ) {
			items.push( { kind: 'push', stateId, state } );
		}
	}

	for ( const [ stateId, state ] of Object.entries( pullStates ) ) {
		const key = state.status.key;
		if ( key !== 'finished' && key !== 'cancelled' ) {
			items.push( { kind: 'pull', stateId, state } );
		}
	}

	// Sort stably by stateId for deterministic ordering
	items.sort( ( a, b ) => a.stateId.localeCompare( b.stateId ) );

	if ( items.length === 0 ) {
		return null;
	}

	return (
		<div
			className="fixed z-40 w-full max-w-[560px] rounded-lg border border-frame-border bg-frame-surface shadow-lg"
			style={ { bottom: '16px', left: '50%', transform: 'translateX(-50%)' } }
		>
			<div className="divide-y divide-frame-border">
				{ items.map( ( item ) => (
					<SyncRow key={ item.stateId } item={ item } />
				) ) }
			</div>
		</div>
	);
}
