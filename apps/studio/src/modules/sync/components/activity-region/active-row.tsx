import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import ProgressBar, { ProgressBarWithAutoIncrement } from 'src/components/progress-bar';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { canCancelPull, canCancelPush } from 'src/lib/active-sync-operations';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync/sync-operations-slice';

const AUTO_INCREMENT_KEYS_PULL = [ 'in-progress' ] as const;
const AUTO_INCREMENT_KEYS_PUSH = [ 'creatingRemoteBackup', 'applyingChanges' ] as const;

type ActiveRowProps = {
	stateId: string;
};

export function ActiveRow( { stateId }: ActiveRowProps ) {
	const dispatch = useAppDispatch();
	const { getPushUploadPercentage, getPushUploadMessage } = useSyncStatesProgressInfo();

	const pullState = useRootSelector(
		( state ) => syncOperationsSelectors.selectPullStates( state )[ stateId ]
	);
	const pushState = useRootSelector(
		( state ) => syncOperationsSelectors.selectPushStates( state )[ stateId ]
	);

	const state = pullState ?? pushState;
	const isPush = ! pullState && !! pushState;

	if ( ! state ) {
		return null;
	}

	const { status, selectedSite, remoteSiteUrl } = state;
	const remoteLabel = remoteSiteUrl ? getHostnameFromUrl( remoteSiteUrl ) : __( 'Production' );
	const glyph = isPush ? '↓' : '↑';

	let message = status.message;
	if ( isPush && pushState ) {
		const pushStatus = pushState.status;
		const uploadPct = getPushUploadPercentage( pushStatus.key, pushState.uploadProgress );
		message = getPushUploadMessage( pushStatus.message, uploadPct );
	}

	const useAutoIncrement = isPush
		? ( AUTO_INCREMENT_KEYS_PUSH as readonly string[] ).includes( status.key )
		: ( AUTO_INCREMENT_KEYS_PULL as readonly string[] ).includes( status.key );

	const selectedSiteId = selectedSite.id;
	const remoteSiteId = state.remoteSiteId;

	const isCancellable = isPush
		? canCancelPush( pushState!.status.key )
		: canCancelPull( pullState!.status.key );

	function handleCancel() {
		if ( isPush ) {
			void dispatch( syncOperationsThunks.cancelPush( { selectedSiteId, remoteSiteId } ) );
		} else {
			void dispatch( syncOperationsThunks.cancelPull( { selectedSiteId, remoteSiteId } ) );
		}
	}

	return (
		<div className="flex flex-col gap-1.5 p-3 border-b border-frame-border last:border-b-0">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="shrink-0 text-frame-text-secondary">{ glyph }</span>
					<span className="truncate text-sm font-medium text-frame-text">{ remoteLabel }</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-frame-text-secondary">{ message }</span>
					<Button
						size="small"
						variant="secondary"
						onClick={ handleCancel }
						disabled={ ! isCancellable }
					>
						{ __( 'Cancel' ) }
					</Button>
				</div>
			</div>
			{ useAutoIncrement ? (
				<ProgressBarWithAutoIncrement value={ status.progress } maxValue={ 100 } />
			) : (
				<ProgressBar value={ status.progress } maxValue={ 100 } />
			) }
		</div>
	);
}
