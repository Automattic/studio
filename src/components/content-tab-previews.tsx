import { ProgressBar, DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check, external, Icon, arrowDown, moreVertical, update, trash } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect } from 'react';
import {
	CLIENT_ID,
	DEMO_SITE_SIZE_LIMIT_GB,
	PROTOCOL_PREFIX,
	SCOPES,
	WP_AUTHORIZE_ENDPOINT,
} from 'src/constants';
import { useArchiveErrorMessages } from 'src/hooks/use-archive-error-messages';
import { useArchiveSite } from 'src/hooks/use-archive-site';
import { useAuth } from 'src/hooks/use-auth';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { useOffline } from 'src/hooks/use-offline';
import { useProgressTimer } from 'src/hooks/use-progress-timer';
import { useSiteSize } from 'src/hooks/use-site-size';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ArrowIcon } from './arrow-icon';
import { Badge } from './badge';
import Button from './button';
import offlineIcon from './offline-icon';
import { ScreenshotDemoSite } from './screenshot-demo-site';
import { DynamicTooltip, Tooltip, TooltipProps } from './tooltip';

interface ContentTabPreviewsProps {
	selectedSite: SiteDetails;
}

function EmptyGeneric( {
	children,
	selectedSite,
}: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4">
			<div className="flex flex-col">
				<div className="a8c-subtitle mb-1">{ __( 'Share a preview of your Studio site' ) }</div>
				<div className="w-[40ch] text-a8c-gray-70 a8c-body">
					{ __(
						'Get feedback from anyone, anywhere with a free hosted preview of your Studio site.'
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Create up to 10 preview links for free.' ),
						__( 'Preview links expire 7 days after the last update.' ),
						createInterpolateElement( __( 'Powered by <a> WordPress.com</a>.' ), {
							a: (
								<Button
									variant="link"
									className="whitespace-pre"
									onClick={ () =>
										getIpcApi().openURL(
											'https://wordpress.com/?utm_source=studio&utm_medium=referral&utm_campaign=demo_sites_onboarding'
										)
									}
								/>
							),
						} ),
					].map( ( text ) => (
						<div
							key={ typeof text === 'string' ? text : 'wordpress-com' }
							className="text-a8c-gray-70 a8c-body flex items-center"
						>
							<Icon className="fill-a8c-blueberry ltr:mr-2 rtl:ml-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col shrink-0 items-end">
				<ScreenshotDemoSite site={ selectedSite } />
			</div>
		</div>
	);
}

function NoAuth( { selectedSite }: React.ComponentProps< typeof EmptyGeneric > ) {
	const isOffline = useOffline();
	const { __ } = useI18n();
	const { authenticate } = useAuth();
	const offlineMessage = __( "You're currently offline." );

	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<div className="mt-8">
				<Tooltip disabled={ ! isOffline } icon={ offlineIcon } text={ offlineMessage }>
					<Button
						aria-description={ isOffline ? offlineMessage : '' }
						aria-disabled={ isOffline }
						variant="primary"
						onClick={ () => {
							if ( isOffline ) {
								return;
							}
							authenticate();
						} }
					>
						{ __( 'Log in to WordPress.com' ) }
						<Icon className="ltr:ml-1 rtl:mr-1 rtl:scale-x-[-1]" icon={ external } size={ 21 } />
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 w-[40ch] text-a8c-gray-70 a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					{ createInterpolateElement(
						__(
							'A WordPress.com account is required to create preview links. <a>Create a free account</a>'
						),
						{
							a: (
								<Button
									aria-description={ isOffline ? offlineMessage : '' }
									aria-disabled={ isOffline }
									className="!p-0 text-a8c-blueberry hover:opacity-80 h-auto"
									onClick={ () => {
										if ( isOffline ) {
											return;
										}
										const baseURL = 'https://wordpress.com/log-in/link';
										const authURL = encodeURIComponent(
											`${ WP_AUTHORIZE_ENDPOINT }?response_type=token&client_id=${ CLIENT_ID }&redirect_uri=${ PROTOCOL_PREFIX }%3A%2F%2Fauth&scope=${ SCOPES }&from-calypso=1`
										);
										const finalURL = `${ baseURL }?redirect_to=${ authURL }&client_id=${ CLIENT_ID }`;
										getIpcApi().openURL( finalURL );
									} }
								/>
							),
						}
					) }
				</Tooltip>
			</div>
		</EmptyGeneric>
	);
}

function AddPreviewSiteWithProgress( {
	isSnapshotLoading,
	selectedSite,
	className = '',
	tagline = '',
}: {
	isSnapshotLoading?: boolean;
	selectedSite: SiteDetails;
	className?: string;
	tagline?: string;
} ) {
	const { __, _n } = useI18n();
	const { archiveSite, isUploadingSiteId, isAnySiteArchiving } = useArchiveSite();
	const isUploading = isUploadingSiteId( selectedSite.id );
	const { activeSnapshotCount, snapshotQuota, isLoadingSnapshotUsage, snapshotCreationBlocked } =
		useSnapshots();
	const isLimitUsed = activeSnapshotCount >= snapshotQuota;
	const { isOverLimit } = useSiteSize( selectedSite.id );
	const isOffline = useOffline();
	const { progress, setProgress } = useProgressTimer( {
		paused: ! isUploading && ! isSnapshotLoading,
		initialProgress: 5,
		interval: 1500,
		maxValue: 95,
	} );
	const errorMessages = useArchiveErrorMessages();

	useEffect( () => {
		if ( isSnapshotLoading ) {
			setProgress( 80 );
		}
	}, [ isSnapshotLoading, setProgress ] );

	const isDisabled =
		isAnySiteArchiving ||
		isUploading ||
		isLoadingSnapshotUsage ||
		isLimitUsed ||
		isOffline ||
		snapshotCreationBlocked;
	const siteArchivingMessage = __(
		'A different preview link is being created. Please wait for it to finish before creating another.'
	);
	const allotmentConsumptionMessage = sprintf(
		_n(
			"You've used %s preview links available on your account.",
			"You've used all %s preview links available on your account.",
			snapshotQuota
		),
		snapshotQuota
	);
	const offlineMessage = __( 'Creating a preview link requires an internet connection.' );
	const overLimitMessage = sprintf(
		__(
			'Your site exceeds %s GB in size. Creating a preview link for a larger site may take considerable amount of time and could exceed the maximum allowed size for a preview link.'
		),
		DEMO_SITE_SIZE_LIMIT_GB
	);

	const userBlockedMessage = errorMessages.rest_site_creation_blocked;

	let tooltipContent;
	if ( isOffline ) {
		tooltipContent = {
			icon: offlineIcon,
			text: offlineMessage,
		};
	} else if ( isLimitUsed ) {
		tooltipContent = { text: allotmentConsumptionMessage };
	} else if ( isAnySiteArchiving ) {
		tooltipContent = { text: siteArchivingMessage };
	} else if ( snapshotCreationBlocked ) {
		tooltipContent = { text: userBlockedMessage };
	} else if ( isOverLimit ) {
		tooltipContent = { text: overLimitMessage };
	}

	return (
		<div className={ className }>
			{ isUploading || isSnapshotLoading ? (
				<div className="w-[300px]">
					<ProgressBar value={ progress } max={ 100 } />
					<div className="text-a8c-gray-70 a8c-body mt-4">
						{ tagline || __( 'Generating preview link' ) }
					</div>
				</div>
			) : (
				<div className="flex gap-4">
					<Tooltip disabled={ ! tooltipContent } { ...tooltipContent } placement="top-start">
						<Button
							aria-description={ tooltipContent?.text ?? '' }
							aria-disabled={ isDisabled }
							variant="primary"
							onClick={ () => {
								if ( isDisabled ) {
									return;
								}
								archiveSite( selectedSite.id );
							} }
						>
							{ __( 'Create preview link' ) }
						</Button>
					</Tooltip>
				</div>
			) }
		</div>
	);
}

function SnapshotRow( {
	snapshot,
	previousSnapshot,
	selectedSite,
}: {
	snapshot: Snapshot;
	previousSnapshot: Snapshot | null;
	selectedSite: SiteDetails;
} ) {
	const { url, date, isDeleting } =
		previousSnapshot && snapshot.isLoading ? previousSnapshot : snapshot;
	const { countDown, isExpired, dateString } = useExpirationDate( date );
	const { deleteSnapshot, fetchSnapshotUsage, snapshotCreationBlocked, removeSnapshot } =
		useSnapshots();
	const { isUploadingSiteId } = useArchiveSite();
	const isUploading = isUploadingSiteId( selectedSite.id );
	const { updateDemoSite, isDemoSiteUpdating } = useUpdateDemoSite();
	const errorMessages = useArchiveErrorMessages();
	const isSiteDemoUpdating = isDemoSiteUpdating( snapshot.localSiteId );
	const { formatRelativeTime } = useFormatLocalizedTimestamps();

	const { isOverLimit } = useSiteSize( selectedSite.id );

	const isOffline = useOffline();
	const updateDemoSiteOfflineMessage = __(
		'Updating a demo site requires an internet connection.'
	);
	const deleteDemoSiteOfflineMessage = __(
		'Deleting a demo site requires an internet connection.'
	);
	const getLastUpdateTimeText = () => {
		if ( ! date ) {
			return __( 'Never updated' );
		}
		const timeDistance = formatRelativeTime( new Date( date ).toISOString() );
		return sprintf( __( '%s ago' ), timeDistance );
	};
	const userBlockedMessage = errorMessages.rest_site_creation_blocked;

	const { progress, setProgress } = useProgressTimer( {
		paused: ! isSiteDemoUpdating,
		initialProgress: 5,
		interval: 1500,
		maxValue: 95,
	} );

	useEffect( () => {
		fetchSnapshotUsage();
	}, [ fetchSnapshotUsage ] );

	useEffect( () => {
		if ( isSiteDemoUpdating ) {
			setProgress( 80 );
		}
	}, [ isSiteDemoUpdating, setProgress ] );

	// if ( isDeleting ) {
	// 	return <SnapshotRowLoading>{ __( 'Deleting demo site…' ) }</SnapshotRowLoading>;
	// }
	const urlWithHTTPS = `https://${ url }`;
	const handleUpdateDemoSite = async () => {
		const dontShowUpdateWarning = localStorage.getItem( 'dontShowUpdateWarning' );

		if ( ! dontShowUpdateWarning ) {
			const UPDATE_BUTTON_INDEX = 0;
			const CANCEL_BUTTON_INDEX = 1;

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				type: 'info',
				message: __( 'Overwrite demo site' ),
				detail: __(
					"Updating will replace the existing files and database with a copy from your local site. Any changes you've made to your demo site will be permanently lost."
				),
				buttons: [ __( 'Update' ), __( 'Cancel' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				checkboxLabel: __( "Don't show this warning again" ),
				checkboxChecked: false,
			} );

			if ( response === UPDATE_BUTTON_INDEX ) {
				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowUpdateWarning', 'true' );
				}

				updateDemoSite( snapshot, selectedSite );
			}
		} else {
			updateDemoSite( snapshot, selectedSite );
		}
	};

	let tooltipContent: Partial< TooltipProps & { text?: string } > = {};
	if ( isOffline ) {
		tooltipContent = {
			icon: offlineIcon,
			text: updateDemoSiteOfflineMessage,
		};
	} else if ( snapshotCreationBlocked ) {
		tooltipContent = { text: userBlockedMessage };
	} else if ( isOverLimit ) {
		tooltipContent = {
			text: sprintf(
				__(
					'Your site exceeds %s GB in size. Updating this demo site may take considerable amount of time and could exceed the maximum allowed size for a demo site.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			),
		};
	}
	const isUpdateDisabled = isOffline || snapshotCreationBlocked;

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="flex gap-2 items-center">
						<div className="a8c-subtitle-small demo-site-name line-clamp-1 break-all">
							{ selectedSite.name }
						</div>
					</div>
					<Button
						variant="link"
						className="!text-a8c-gray-70 hover:!text-a8c-blueberry max-w-[100%]"
						onClick={ () => {
							getIpcApi().openURL( urlWithHTTPS );
						} }
					>
						<span className="truncate">{ urlWithHTTPS }</span>
						<ArrowIcon />
					</Button>
				</div>
				<div className="flex ml-auto">
					<div className="w-[110px] text-a8c-gray-70">{ getLastUpdateTimeText() }</div>
					<div className="w-[100px] text-a8c-gray-70">{ countDown }</div>
					<div className="w-[60px] pr-2">
						<PreviewActionButtonsMenu snapshot={ snapshot } selectedSite={ selectedSite } />
					</div>
				</div>
			</div>
		</div>
	);
}

function PreviewActionButtonsMenu( {
	snapshot,
}: {
	snapshot: Snapshot;
	selectedSite: SiteDetails;
} ) {
	const { __ } = useI18n();
	const { deleteSnapshot } = useSnapshots();
	const { updateDemoSite } = useUpdateDemoSite();

	return (
		<DropdownMenu
			icon={ moreVertical }
			label={ __( 'Preview actions' ) }
			className="p-1 flex items-center"
		>
			{ ( { onClose }: { onClose: () => void } ) => (
				<MenuGroup className="w-40 overflow-hidden">
					<MenuItem
						onClick={ () => {
							handleUpdateDemoSite();
							onClose();
						} }
					>
						<span>{ __( 'Rename' ) }</span>
					</MenuItem>
					<MenuItem
						onClick={ () => {
							handleUpdateDemoSite();
							onClose();
						} }
					>
						<span>{ __( 'Update' ) }</span>
					</MenuItem>
					<MenuItem
						isDestructive
						onClick={ () => {
							deleteSnapshot( snapshot );
							onClose();
						} }
					>
						<span>{ __( 'Delete' ) }</span>
					</MenuItem>
				</MenuGroup>
			) }
		</DropdownMenu>
	);
}

function NoPreviews( {
	selectedSite,
	isSnapshotLoading,
}: React.ComponentProps< typeof EmptyGeneric > & { isSnapshotLoading?: boolean } ) {
	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<AddPreviewSiteWithProgress
				className="mt-8"
				selectedSite={ selectedSite }
				isSnapshotLoading={ isSnapshotLoading }
			/>
		</EmptyGeneric>
	);
}

function PreviewLinksTableHeader() {
	const { __ } = useI18n();
	return (
		<div className="border-b border-a8c-gray-5">
			<div className="flex items-center h-12 px-8 text-gray-900 text-xs uppercase">
				<div className="w-[51%]">{ __( 'Preview link' ) }</div>
				<div className="flex ml-auto">
					<div className="w-[110px] flex items-center">
						{ __( 'Updated' ) }
						<Icon icon={ arrowDown } height={ 13 } width={ 16 } />
					</div>
					<div className="w-[100px]">{ __( 'Expires' ) }</div>
					<div className="w-[60px] text-right">{ __( 'Actions' ) }</div>
				</div>
			</div>
		</div>
	);
}

export function ContentTabPreviews( { selectedSite }: ContentTabPreviewsProps ) {
	const { __ } = useI18n();
	const { snapshots } = useSnapshots();
	const { isAuthenticated } = useAuth();
	if ( ! isAuthenticated ) {
		return <NoAuth selectedSite={ selectedSite } />;
	}

	const snapshotsOnSite = snapshots.filter(
		( snapshot ) => snapshot.localSiteId === selectedSite.id
	);
	const snapshot = snapshotsOnSite[ 0 ] || null;
	const previousSnapshot = snapshotsOnSite[ 1 ] || null;
	if ( ! snapshot || ( snapshotsOnSite.length === 1 && snapshotsOnSite[ 0 ].isLoading ) ) {
		return <NoPreviews selectedSite={ selectedSite } isSnapshotLoading={ snapshot?.isLoading } />;
	}
	return (
		<div className="w-full">
			<PreviewLinksTableHeader />
			<SnapshotRow
				snapshot={ snapshot }
				previousSnapshot={ previousSnapshot }
				selectedSite={ selectedSite }
				key={ snapshot.atomicSiteId }
			/>
		</div>
	);
}
