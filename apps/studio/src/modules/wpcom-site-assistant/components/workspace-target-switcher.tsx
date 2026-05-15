import { __ } from '@wordpress/i18n';
import { Tooltip } from 'src/components/tooltip';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	getStagingPlanUpgradeUrl,
	isStagingPlanUpgradeRequired,
} from 'src/modules/wpcom-site-assistant/lib/staging';
import type { SyncSite } from '@studio/common/types/sync';
import type { WpcomSiteWorkspace } from 'src/modules/wpcom-site-assistant/lib/workspaces';

type WorkspaceTargetSwitcherProps = {
	workspace?: WpcomSiteWorkspace;
	selectedWpcomSite?: SyncSite;
	selectedLocalSite?: SiteDetails | null;
	onSelectWpcomSite: ( site: SyncSite ) => void;
	onSelectLocalSite?: ( site: SiteDetails ) => void;
	onCreateStagingSite: () => void;
	canCreateStagingSite: boolean;
	isCreatingStagingSite: boolean;
	stagingDisabledReason?: string;
	localDisabledReason?: string;
};

export function WorkspaceTargetSwitcher( {
	workspace,
	selectedWpcomSite,
	selectedLocalSite,
	onSelectWpcomSite,
	onSelectLocalSite,
	onCreateStagingSite,
	canCreateStagingSite,
	isCreatingStagingSite,
	stagingDisabledReason,
	localDisabledReason = __( 'Local target support is not available for this workspace.' ),
}: WorkspaceTargetSwitcherProps ) {
	const productionSite =
		workspace?.productionSite ??
		( selectedWpcomSite && ! selectedWpcomSite.isStaging ? selectedWpcomSite : undefined );
	const stagingSite =
		workspace?.stagingSites[ 0 ] ??
		( selectedWpcomSite?.isStaging ? selectedWpcomSite : undefined );
	const localSite = workspace?.localSite ?? selectedLocalSite ?? undefined;
	const isProductionSelected = productionSite?.id === selectedWpcomSite?.id;
	const isStagingSelected =
		stagingSite?.id === selectedWpcomSite?.id || selectedWpcomSite?.isStaging;
	const isLocalSelected = Boolean(
		localSite && ! selectedWpcomSite && selectedLocalSite?.id === localSite.id
	);
	const isProductionDisabled = ! productionSite;
	const isLocalDisabled = ! localSite || ! onSelectLocalSite;
	const isStagingUpgradeAvailable = Boolean(
		productionSite && ! stagingSite && isStagingPlanUpgradeRequired( productionSite )
	);
	const isStagingDisabled =
		! stagingSite &&
		! isStagingUpgradeAvailable &&
		( ! canCreateStagingSite || isCreatingStagingSite );
	const productionTooltip = isProductionDisabled
		? __( 'Production site details are not available yet.' )
		: undefined;
	const stagingTooltip = isStagingUpgradeAvailable
		? __( "Upgrade this site's plan to add a staging site." )
		: stagingDisabledReason ??
		  ( isCreatingStagingSite ? __( 'Creating staging site...' ) : undefined );
	const localTooltip = isLocalDisabled ? localDisabledReason : undefined;

	const getSelectedButtonClassName = ( target: 'production' | 'staging' | 'local' ) => {
		if ( target === 'staging' ) {
			return 'border-circle-env-staging bg-frame-surface text-frame-text';
		}

		return 'border-transparent bg-a8c-green-5 text-a8c-green-70';
	};

	const getButtonClassName = (
		target: 'production' | 'staging' | 'local',
		isSelected: boolean,
		needsUpgrade = false
	) =>
		cx(
			'inline-flex min-h-6 shrink-0 items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme disabled:cursor-not-allowed disabled:opacity-60',
			needsUpgrade &&
				'border-dashed border-circle-env-staging bg-transparent text-frame-text-secondary hover:text-frame-text',
			isSelected
				? getSelectedButtonClassName( target )
				: ! needsUpgrade &&
						'border-transparent bg-frame-surface text-frame-text-secondary hover:text-frame-text'
		);

	return (
		<div className="flex items-center gap-2 whitespace-nowrap">
			<Tooltip text={ productionTooltip } disabled={ ! productionTooltip } placement="bottom-start">
				<button
					type="button"
					className={ getButtonClassName( 'production', Boolean( isProductionSelected ) ) }
					disabled={ isProductionDisabled }
					onClick={ () => productionSite && onSelectWpcomSite( productionSite ) }
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-circle-env-production" />
					{ __( 'Production' ) }
				</button>
			</Tooltip>
			<Tooltip text={ stagingTooltip } disabled={ ! stagingTooltip } placement="bottom-start">
				<button
					type="button"
					className={ getButtonClassName(
						'staging',
						Boolean( isStagingSelected ),
						isStagingUpgradeAvailable
					) }
					disabled={ isStagingDisabled }
					onClick={ () => {
						if ( stagingSite ) {
							onSelectWpcomSite( stagingSite );
							return;
						}

						if ( productionSite && isStagingUpgradeAvailable ) {
							getIpcApi().openURL( getStagingPlanUpgradeUrl( productionSite ) );
							return;
						}

						onCreateStagingSite();
					} }
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-circle-env-staging" />
					{ isCreatingStagingSite ? __( 'Creating staging...' ) : __( 'Staging' ) }
				</button>
			</Tooltip>
			<Tooltip text={ localTooltip } disabled={ ! localTooltip } placement="bottom-start">
				<button
					type="button"
					className={ getButtonClassName( 'local', isLocalSelected ) }
					disabled={ isLocalDisabled }
					onClick={ () => localSite && onSelectLocalSite?.( localSite ) }
				>
					<span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-a8c-gray-40" />
					{ __( 'Local' ) }
				</button>
			</Tooltip>
		</div>
	);
}
