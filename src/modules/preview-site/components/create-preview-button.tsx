import { __, sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import semver from 'semver';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { Tooltip } from 'src/components/tooltip';
import { DEMO_SITE_SIZE_LIMIT_GB } from 'src/constants';
import { useArchiveErrorMessages } from 'src/hooks/use-archive-error-messages';
import { useArchiveSite } from 'src/hooks/use-archive-site';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteSize } from 'src/hooks/use-site-size';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useRootSelector } from 'src/stores';
import { wordpressVersionsSelectors } from 'src/stores/wordpress-versions-slice';
import { DEFAULT_PHP_VERSION } from 'vendor/wp-now/src/constants';

interface CreatePreviewButtonProps {
	onClick: () => void;
	selectedSite: SiteDetails;
}

export function CreatePreviewButton( { onClick, selectedSite }: CreatePreviewButtonProps ) {
	const { __, _n } = useI18n();
	const { isAnySiteArchiving, archivingSiteId } = useArchiveSite();
	const { activeSnapshotCount, snapshotQuota, isLoadingSnapshotUsage, snapshotCreationBlocked } =
		useSnapshots();
	const isLimitUsed = activeSnapshotCount >= snapshotQuota;
	const { isOverLimit } = useSiteSize( selectedSite.id );
	const isOffline = useOffline();
	const errorMessages = useArchiveErrorMessages();
	const [ wpVersion ] = useGetWpVersion( selectedSite );
	const wpVersions = useRootSelector( wordpressVersionsSelectors.selectWordPressVersions );

	const isCurrentSiteArchiving = archivingSiteId === selectedSite.id;
	const isOtherSiteArchiving = isAnySiteArchiving && ! isCurrentSiteArchiving;

	// Jurrasic Ninja will use the default version for PHP and latest or above for WordPress.
	const latestWpVersion = wpVersions.find( ( version ) => version.isBeta === false )?.value;
	const isPhpVersionDefault = selectedSite.phpVersion === DEFAULT_PHP_VERSION;
	const coercedWpVersion = semver.coerce( wpVersion );
	const coercedLatestWpVersion = semver.coerce( latestWpVersion );
	const isWpVersionBelowDefault =
		latestWpVersion &&
		wpVersion !== '-' &&
		wpVersion !== 'latest' &&
		coercedWpVersion &&
		coercedLatestWpVersion &&
		semver.compare( coercedWpVersion, coercedLatestWpVersion ) < 0;

	const isDisabled =
		isAnySiteArchiving ||
		isLoadingSnapshotUsage ||
		isLimitUsed ||
		isOffline ||
		snapshotCreationBlocked ||
		isOverLimit;

	const currentSiteArchivingMessage = __(
		'A preview of this site is being created. Please wait for it to finish before creating another.'
	);
	const otherSiteArchivingMessage = __(
		'A different preview site is being created. Please wait for it to finish before creating another.'
	);
	const allotmentConsumptionMessage = sprintf(
		_n(
			"You've used %s preview sites available on your account.",
			"You've used all %s preview sites available on your account.",
			snapshotQuota
		),
		snapshotQuota
	);
	const offlineMessage = __( 'Creating a preview site requires an internet connection.' );
	const overLimitMessage = sprintf(
		__(
			'Your site exceeds the %s GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
		),
		DEMO_SITE_SIZE_LIMIT_GB
	);

	const versionMismatchMessages = [];
	if ( ! isPhpVersionDefault || isWpVersionBelowDefault ) {
		const versionChanges = [];
		if ( ! isPhpVersionDefault ) {
			versionChanges.push( sprintf( __( 'PHP %s' ), DEFAULT_PHP_VERSION ) );
		}
		if ( isWpVersionBelowDefault ) {
			versionChanges.push( sprintf( __( 'WordPress %s' ), coercedLatestWpVersion ) );
		}
		versionMismatchMessages.push(
			sprintf(
				__( 'Your site is using an unsupported version. The preview site will use %s.' ),
				versionChanges.join( __( ' and ' ) )
			)
		);
	}

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
		tooltipContent = { text: errorMessages.rest_site_creation_blocked };
	} else if ( isOverLimit ) {
		tooltipContent = { text: overLimitMessage };
	} else if ( versionMismatchMessages.length > 0 ) {
		tooltipContent = { text: versionMismatchMessages.join( '' ) };
	}

	return (
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
	);
}
