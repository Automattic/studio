import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
} from 'src/stores/sync/sync-operations-slice';

type FailedRowProps = {
	stateId: string;
};

export function FailedRow( { stateId }: FailedRowProps ) {
	const dispatch = useAppDispatch();

	const pullState = useRootSelector(
		( state ) => syncOperationsSelectors.selectPullStates( state )[ stateId ]
	);
	const pushState = useRootSelector(
		( state ) => syncOperationsSelectors.selectPushStates( state )[ stateId ]
	);

	const state = pullState ?? pushState;
	const isPush = ! pullState && !! pushState;

	if ( ! state || state.status.key !== 'failed' ) {
		return null;
	}

	const { status, remoteSiteUrl } = state;
	const remoteLabel = remoteSiteUrl ? getHostnameFromUrl( remoteSiteUrl ) : __( 'Production' );
	const glyph = isPush ? '↓' : '↑';
	const selectedSiteId = state.selectedSite.id;
	const remoteSiteId = state.remoteSiteId;

	function handleDismiss() {
		if ( isPush ) {
			dispatch( syncOperationsActions.clearPushState( { selectedSiteId, remoteSiteId } ) );
		} else {
			dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
		}
	}

	return (
		<div className="flex flex-col gap-1.5 p-3 border-b border-frame-border border-l-4 border-l-frame-error last:border-b-0">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5 min-w-0">
					<span className="shrink-0 text-frame-error">{ glyph }</span>
					<span className="truncate text-sm font-medium text-frame-text">{ remoteLabel }</span>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<span className="text-xs text-frame-error">
						{ status.message || __( 'Sync failed' ) }
					</span>
					<Button size="small" variant="secondary" onClick={ handleDismiss }>
						{ __( 'Dismiss' ) }
					</Button>
				</div>
			</div>
		</div>
	);
}
