import { DEMO_SITE_SIZE_LIMIT_GB } from '@studio/common/constants';
import { Icon } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { cautionFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { AuthContextType } from 'src/components/auth-provider';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useIsMultisite } from 'src/hooks/use-is-multisite';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteSize } from 'src/hooks/use-site-size';
import { getLatestStableWpVersion } from 'src/lib/version-utils';
import { hasUnsupportedWpOrPhpVersion } from 'src/modules/preview-site/lib/version-comparison';
import { useRootSelector } from 'src/stores';
import { snapshotSelectors } from 'src/stores/snapshot-slice';
import { useGetWordPressVersions } from 'src/stores/wordpress-versions-api';
import { useGetSnapshotUsage } from 'src/stores/wpcom-api';

interface CreatePreviewButtonProps {
	onClick: () => void;
	selectedSite: SiteDetails;
	user: AuthContextType[ 'user' ];
}

export function CreatePreviewButton( { onClick, selectedSite, user }: CreatePreviewButtonProps ) {
	const { __, _n } = useI18n();
	const activeOperationsForAnySite = useRootSelector(
		snapshotSelectors.selectActiveCreateUpdateOperationsForAnySite
	);
	const activeOperationsForCurrentSite = useRootSelector( ( state ) =>
		snapshotSelectors.selectActiveCreateOperationForSite( state, selectedSite.id )
	);
	const snapshotQuota = useRootSelector( ( state ) => state.snapshot.snapshotQuota );
	const { data: snapshotUsage } = useGetSnapshotUsage();
	const snapshotCreationBlocked = snapshotUsage?.siteCreationBlocked ?? false;
	const snapshotsByUser = useRootSelector( ( state ) =>
		snapshotSelectors.selectSnapshotsByUser( state, user?.id ?? 0 )
	);

	const activeSnapshotCount = snapshotUsage?.siteCount ?? snapshotsByUser?.length ?? 0;

	const isLimitUsed = activeSnapshotCount >= snapshotQuota;
	const { isOverLimit } = useSiteSize( selectedSite.id );
	const isOffline = useOffline();
	const [ wpVersion ] = useGetWpVersion( selectedSite );
	const { data: wpVersions = [] } = useGetWordPressVersions( {
		minimumVersion: '',
	} );

	const isAnySiteArchiving = !! activeOperationsForAnySite.length;
	const isCurrentSiteArchiving = !! activeOperationsForCurrentSite;
	const isOtherSiteArchiving = isAnySiteArchiving && ! isCurrentSiteArchiving;

	const latestWpVersion = getLatestStableWpVersion( wpVersions );
	const shouldShowVersionMismatch = hasUnsupportedWpOrPhpVersion( {
		wpVersion,
		latestWpVersion,
		phpVersion: selectedSite.phpVersion,
	} );
	const isMultisite = useIsMultisite( selectedSite );

	const isDisabled =
		isAnySiteArchiving || isLimitUsed || isOffline || snapshotCreationBlocked || isOverLimit;

	const currentSiteArchivingMessage = __(
		'A preview of this site is being created. Please wait for it to finish before creating another.'
	);
	const otherSiteArchivingMessage = __(
		'A different preview site is being created. Please wait for it to finish before creating another.'
	);
	const allotmentConsumptionMessage = sprintf(
		_n(
			"You've used %d preview sites available on your account.",
			"You've used all %d preview sites available on your account.",
			snapshotQuota
		),
		snapshotQuota
	);
	const offlineMessage = __( 'Creating a preview site requires an internet connection.' );
	const overLimitMessage = sprintf(
		__(
			'Your site exceeds the %d GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
		),
		DEMO_SITE_SIZE_LIMIT_GB
	);
	const snapshotCreationBlockedMessage = __( 'Preview sites are not available for your account.' );

	let tooltipContent;
	if ( isOffline ) {
		tooltipContent = {
			icon: offlineIcon,
			text: offlineMessage,
		};
	} else if ( isLimitUsed ) {
		tooltipContent = { text: allotmentConsumptionMessage };
	} else if ( isCurrentSiteArchiving ) {
		tooltipContent = { text: currentSiteArchivingMessage };
	} else if ( isOtherSiteArchiving ) {
		tooltipContent = { text: otherSiteArchivingMessage };
	} else if ( snapshotCreationBlocked ) {
		tooltipContent = { text: snapshotCreationBlockedMessage };
	} else if ( isOverLimit ) {
		tooltipContent = { text: overLimitMessage };
	}

	const warnings: string[] = [];
	if ( shouldShowVersionMismatch ) {
		warnings.push(
			__(
				'Your Studio site is running versions not supported by preview sites. The preview site will automatically switch to the supported WordPress and PHP versions.'
			)
		);
	}
	if ( isMultisite ) {
		warnings.push(
			__(
				'Your Studio site is configured as a multisite network. Preview sites do not support multisite, which may cause unexpected issues.'
			)
		);
	}

	const warningsTooltipContent =
		warnings.length > 0 ? (
			<ul className="list-disc pl-4 flex flex-col gap-1.5">
				{ warnings.map( ( warning, index ) => (
					<li key={ index }>{ warning }</li>
				) ) }
			</ul>
		) : undefined;

	return (
		<div className="flex items-center gap-3">
			<Tooltip disabled={ ! tooltipContent } { ...tooltipContent } placement="top-start">
				<Button
					aria-description={ tooltipContent?.text ?? '' }
					aria-disabled={ isDisabled }
					variant="primary"
					onClick={ () => {
						if ( isDisabled ) {
							return;
						}
						onClick();
					} }
				>
					{ __( 'Create preview site' ) }
				</Button>
			</Tooltip>
			{ warnings.length > 0 && (
				<Tooltip text={ warningsTooltipContent } placement="top-start">
					<div
						className="flex items-center gap-1 text-amber-500 text-[13px] leading-[16px] cursor-pointer"
						data-testid="preview-warnings-badge"
					>
						<Icon icon={ cautionFilled } size={ 16 } className="fill-amber-500" />
						{ sprintf(
							/* translators: %d: number of warnings */
							_n( '%d warning', '%d warnings', warnings.length ),
							warnings.length
						) }
					</div>
				</Tooltip>
			) }
		</div>
	);
}
