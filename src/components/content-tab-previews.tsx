import { TooltipProps } from '@wordpress/components/build-types/tooltip/types';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check, external, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import Button from 'src/components/button';
import offlineIcon from 'src/components/offline-icon';
import { ScreenshotDemoSite } from 'src/components/screenshot-demo-site';
import { Tooltip } from 'src/components/tooltip';
import {
	CLIENT_ID,
	PROTOCOL_PREFIX,
	SCOPES,
	WP_AUTHORIZE_ENDPOINT,
	LIMIT_OF_ZIP_SITES_PER_USER,
	DEMO_SITE_SIZE_LIMIT_GB,
} from 'src/constants';
import { useArchiveErrorMessages } from 'src/hooks/use-archive-error-messages';
import { useArchiveSite } from 'src/hooks/use-archive-site';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteSize } from 'src/hooks/use-site-size';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CreatePreviewButton } from 'src/modules/preview-site/components/create-preview-button';
import { PreviewSiteRow } from 'src/modules/preview-site/components/preview-site-row';
import { PreviewSitesTableHeader } from 'src/modules/preview-site/components/preview-sites-table-header';
import { ProgressRow } from 'src/modules/preview-site/components/progress-row';

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
						__( `Create up to ${ LIMIT_OF_ZIP_SITES_PER_USER } preview sites for free.` ),
						__( 'Preview sites expire 7 days after the last update.' ),
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
							'A WordPress.com account is required to create preview sites. <a>Create a free account</a>'
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

function NoPreviews( { selectedSite }: React.ComponentProps< typeof EmptyGeneric > ) {
	const { archiveSite } = useArchiveSite();

	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<div className="mt-8">
				<CreatePreviewButton
					onClick={ () => archiveSite( selectedSite.id ) }
					selectedSite={ selectedSite }
				/>
			</div>
		</EmptyGeneric>
	);
}

function getUpdateButtonTooltipContent(
	snapshotCreationBlocked: boolean,
	isOverLimit: boolean,
	userBlockedMessage: string
): Partial< TooltipProps > {
	if ( snapshotCreationBlocked ) {
		return { text: userBlockedMessage };
	}

	if ( isOverLimit ) {
		return {
			text: sprintf(
				__(
					'Your site exceeds %s GB in size. Updating this preview site may take considerable amount of time and could exceed the maximum allowed size for a preview site.'
				),
				DEMO_SITE_SIZE_LIMIT_GB
			),
		};
	}

	return {};
}

export function ContentTabPreviews( { selectedSite }: ContentTabPreviewsProps ) {
	const { __ } = useI18n();
	const { snapshots, snapshotCreationBlocked } = useSnapshots();
	const { isAuthenticated } = useAuth();
	const { archiveSite, isUploadingSiteId } = useArchiveSite();
	const { isOverLimit } = useSiteSize( selectedSite.id );
	const { isDemoSiteUpdating } = useUpdateDemoSite();
	const isUploading = isUploadingSiteId( selectedSite.id );
	const errorMessages = useArchiveErrorMessages();
	const snapshotsOnSite = snapshots.filter(
		( snapshot ) => snapshot.localSiteId === selectedSite.id
	);
	const isSnapshotLoading = snapshotsOnSite.some( ( snapshot ) => snapshot.isLoading );
	const userBlockedMessage = errorMessages.rest_site_creation_blocked;
	const isAnyPreviewUpdating = snapshots.some( ( snapshot ) =>
		isDemoSiteUpdating( snapshot.atomicSiteId )
	);

	const isUpdateDisabled = isAnyPreviewUpdating || snapshotCreationBlocked;

	const tooltipContent = getUpdateButtonTooltipContent(
		snapshotCreationBlocked,
		isOverLimit,
		userBlockedMessage
	);

	if ( ! isAuthenticated ) {
		return <NoAuth selectedSite={ selectedSite } />;
	}

	if ( ! snapshotsOnSite.length && ! isUploading && ! isSnapshotLoading ) {
		return <NoPreviews selectedSite={ selectedSite } />;
	}

	return (
		<div className="relative min-h-full flex flex-col">
			<div className="w-full flex flex-col flex-1">
				<div className="flex-1">
					<PreviewSitesTableHeader />
					<div className="[&>*:not(:last-child)]:border-b [&>*]:border-a8c-gray-5">
						{ ( isUploading || isSnapshotLoading ) && (
							<ProgressRow text={ __( 'Creating preview site' ) } />
						) }
						{ snapshotsOnSite
							.filter( ( snapshot ) => ! snapshot.isLoading )
							.map( ( snapshot ) => (
								<PreviewSiteRow
									snapshot={ snapshot }
									selectedSite={ selectedSite }
									disabledUpdate={ isUpdateDisabled }
									updateButtonTooltipContent={ tooltipContent }
									showUpdateTooltip={ isOverLimit }
									key={ snapshot.atomicSiteId }
								/>
							) ) }
					</div>
				</div>
				<div className="sticky bottom-0 bg-white/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
					<CreatePreviewButton
						onClick={ () => archiveSite( selectedSite.id ) }
						selectedSite={ selectedSite }
					/>
				</div>
			</div>
		</div>
	);
}
