import { Icon } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { cloudDownload, close } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { ClearAction } from 'src/components/clear-action';
import offlineIcon from 'src/components/offline-icon';
import ProgressBar from 'src/components/progress-bar';
import { Tooltip } from 'src/components/tooltip';
import { useOffline } from 'src/hooks/use-offline';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { useDisconnectCpanelSiteMutation } from 'src/stores/cpanel/cpanel-connected-sites';
import {
	cpanelOperationsActions,
	cpanelOperationsSelectors,
	cpanelOperationsThunks,
} from 'src/stores/cpanel/cpanel-operations-slice';
import type { CpanelSyncSite } from 'src/modules/cpanel/types';

type Props = {
	cpanelSite: CpanelSyncSite;
	selectedSite: SiteDetails;
};

export function CpanelConnectedSite( { cpanelSite, selectedSite }: Props ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const isOffline = useOffline();
	const [ disconnectSite ] = useDisconnectCpanelSiteMutation();

	const pullState = useRootSelector(
		cpanelOperationsSelectors.selectPullState( selectedSite.id, cpanelSite.id )
	);

	const isAnySitePulling = useRootSelector( cpanelOperationsSelectors.selectIsAnySitePulling );

	const isPulling =
		pullState?.status.key === 'compressing' ||
		pullState?.status.key === 'downloading' ||
		pullState?.status.key === 'exporting-db' ||
		pullState?.status.key === 'building-archive' ||
		pullState?.status.key === 'importing';

	const hasPullFinished = pullState?.status.key === 'finished';
	const hasPullFailed = pullState?.status.key === 'failed';
	const hasPullCancelled = pullState?.status.key === 'cancelled';

	const handleDisconnect = async () => {
		const { response } = await window.ipcApi.showMessageBox( {
			message: sprintf( __( 'Disconnect %s' ), cpanelSite.hostname ),
			detail: __( 'Your cPanel site will not be affected by disconnecting it from Studio.' ),
			buttons: [ __( 'Disconnect' ), __( 'Cancel' ) ],
			cancelId: 1,
		} );
		if ( response === 0 ) {
			await disconnectSite( {
				cpanelSiteId: cpanelSite.id,
				localSiteId: selectedSite.id,
			} );
		}
	};

	const clearPull = () => {
		dispatch(
			cpanelOperationsActions.clearPullState( {
				localSiteId: selectedSite.id,
				cpanelSiteId: cpanelSite.id,
			} )
		);
	};

	const lastPullText = cpanelSite.lastPullTimestamp
		? sprintf( __( 'Last pulled %s' ), new Date( cpanelSite.lastPullTimestamp ).toLocaleString() )
		: __( 'Never pulled' );

	return (
		<div className="flex flex-col gap-2 border-b border-a8c-gray-0 py-5">
			{ /* Header row: icon + hostname + disconnect */ }
			<div className="flex items-center gap-2 ps-8 pe-5">
				<div className="w-5 h-5 rounded-full bg-a8c-gray-10 flex items-center justify-center text-[10px] font-bold text-a8c-gray-70 shrink-0">
					cP
				</div>
				<div className="a8c-label-semibold truncate">{ cpanelSite.hostname }</div>
				<div className="ms-auto">
					<Tooltip
						text={ __(
							'This site is syncing. Please wait for the sync to finish before disconnecting.'
						) }
						disabled={ ! isPulling }
						placement="top-start"
					>
						<Button
							variant="link"
							className={ ! isPulling ? '!text-a8c-gray-70 hover:!text-a8c-red-50' : '' }
							onClick={ handleDisconnect }
							disabled={ isPulling }
						>
							{ __( 'Disconnect' ) }
						</Button>
					</Tooltip>
				</div>
			</div>

			{ /* Controls / status row */ }
			<div className="grid grid-cols-[max-content_1fr_max-content] ps-8 pe-5 gap-2 items-center">
				<div className="text-a8c-gray-50 a8c-body-small shrink-0">{ lastPullText }</div>

				<div />

				<div className="flex shrink-0 justify-end items-center min-h-[26px] w-80">
					{ isPulling && (
						<div className="flex items-center gap-2 max-w-full">
							<div className="flex flex-col gap-2 min-w-44 flex-shrink">
								<div className="a8c-body-small">{ pullState.status.message }</div>
								<ProgressBar value={ pullState.status.progress } maxValue={ 100 } />
							</div>
							<Tooltip text={ __( 'Cancel pull' ) } placement="top-start">
								<Button
									variant="icon"
									aria-label={ __( 'Cancel pull' ) }
									onClick={ () =>
										dispatch(
											cpanelOperationsThunks.cancelPull( {
												localSiteId: selectedSite.id,
												cpanelSiteId: cpanelSite.id,
											} )
										)
									}
								>
									<span className="flex items-center justify-center w-5 h-5">
										<Icon icon={ close } size={ 20 } />
									</span>
								</Button>
							</Tooltip>
						</div>
					) }

					{ hasPullFinished && (
						<ClearAction onClick={ clearPull }>{ __( 'Pull complete' ) }</ClearAction>
					) }

					{ hasPullFailed && (
						<ClearAction onClick={ clearPull } isError>
							{ __( 'Error pulling site' ) }
						</ClearAction>
					) }

					{ hasPullCancelled && (
						<ClearAction onClick={ clearPull }>{ __( 'Pull cancelled' ) }</ClearAction>
					) }

					{ ! isPulling && ! hasPullFinished && ! hasPullFailed && ! hasPullCancelled && (
						<Tooltip
							disabled={ ! isOffline }
							icon={ offlineIcon }
							text={ __( 'Pulling a site requires an internet connection.' ) }
							placement="top-start"
						>
							<Tooltip
								disabled={ ! isAnySitePulling || isOffline }
								text={ __( 'Another site is pulling. Please wait.' ) }
								placement="top-start"
							>
								<Button
									variant="link"
									className={
										! isOffline && ! isAnySitePulling ? '!text-black hover:!text-a8c-blue-50' : ''
									}
									disabled={ isOffline || isAnySitePulling }
									onClick={ () => {
										void dispatch(
											cpanelOperationsThunks.pullSite( {
												cpanelSiteId: cpanelSite.id,
												localSiteId: selectedSite.id,
												selectedSite,
											} )
										);
									} }
									data-testid="cpanel-pull-button"
								>
									<Icon icon={ cloudDownload } />
									{ __( 'Pull' ) }
								</Button>
							</Tooltip>
						</Tooltip>
					) }
				</div>
			</div>
		</div>
	);
}
