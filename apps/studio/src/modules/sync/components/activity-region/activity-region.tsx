import { AnimatePresence, motion } from 'motion/react';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync/sync-operations-slice';
import { ActiveRow } from './active-row';
import { FailedRow } from './failed-row';
import { SetupPanel } from './setup-panel';
import type { SyncSite } from '@studio/common/types/sync';
import type { TreeNode } from 'src/components/tree-view';

export type SetupPanelState = {
	localSite: SiteDetails;
	remoteSite: SyncSite;
	type: 'push' | 'pull';
	onPush: ( tree: TreeNode[] ) => void;
	onPull: ( tree: TreeNode[] ) => void;
};

type ActivityRegionProps = {
	localSiteId: string;
	setupPanel: SetupPanelState | null;
	onCloseSetup: () => void;
};

export default function ActivityRegion( {
	localSiteId,
	setupPanel,
	onCloseSetup,
}: ActivityRegionProps ) {
	const pullStates = useRootSelector( syncOperationsSelectors.selectPullStates );
	const pushStates = useRootSelector( syncOperationsSelectors.selectPushStates );

	const activeIds: string[] = [];
	const failedIds: string[] = [];

	for ( const [ stateId, state ] of Object.entries( pushStates ) ) {
		if ( state.selectedSite?.id !== localSiteId ) {
			continue;
		}
		if ( state.status.key === 'failed' ) {
			failedIds.push( stateId );
		} else if ( state.status.key !== 'finished' && state.status.key !== 'cancelled' ) {
			activeIds.push( stateId );
		}
	}

	for ( const [ stateId, state ] of Object.entries( pullStates ) ) {
		if ( state.selectedSite?.id !== localSiteId ) {
			continue;
		}
		if ( state.status.key === 'failed' ) {
			failedIds.push( stateId );
		} else if ( state.status.key !== 'finished' && state.status.key !== 'cancelled' ) {
			activeIds.push( stateId );
		}
	}

	const hasContent = !! setupPanel || activeIds.length > 0 || failedIds.length > 0;

	return (
		<AnimatePresence initial={ false }>
			{ hasContent && (
				<motion.div
					key="activity-region"
					initial={ { height: 0, opacity: 0 } }
					animate={ { height: 'auto', opacity: 1 } }
					exit={ { height: 0, opacity: 0 } }
					transition={ { type: 'spring', stiffness: 500, damping: 40, mass: 0.8 } }
					style={ { overflow: 'hidden' } }
					className="w-full border-t border-frame-border bg-frame"
				>
					{ setupPanel && (
						<SetupPanel
							site={ { localSite: setupPanel.localSite, remoteSite: setupPanel.remoteSite } }
							type={ setupPanel.type }
							onPush={ setupPanel.onPush }
							onPull={ setupPanel.onPull }
							onRequestClose={ onCloseSetup }
						/>
					) }
					{ activeIds.length > 0 && (
						<div>
							{ activeIds.map( ( stateId ) => (
								<ActiveRow key={ stateId } stateId={ stateId } />
							) ) }
						</div>
					) }
					{ failedIds.length > 0 && (
						<div>
							{ failedIds.map( ( stateId ) => (
								<FailedRow key={ stateId } stateId={ stateId } />
							) ) }
						</div>
					) }
				</motion.div>
			) }
		</AnimatePresence>
	);
}
