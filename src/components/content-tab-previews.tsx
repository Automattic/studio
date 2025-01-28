import { Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check, external, Icon, arrowDown } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect } from 'react';
import { CLIENT_ID, PROTOCOL_PREFIX, SCOPES, WP_AUTHORIZE_ENDPOINT } from 'src/constants';
import { useArchiveSite } from 'src/hooks/use-archive-site';
import { useAuth } from 'src/hooks/use-auth';
import { useExpirationDate } from 'src/hooks/use-expiration-date';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { useOffline } from 'src/hooks/use-offline';
import { useProgressTimer } from 'src/hooks/use-progress-timer';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { useUpdateDemoSite } from 'src/hooks/use-update-demo-site';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CreatePreviewButton } from 'src/modules/preview-site/components/create-preview-button';
import { PreviewActionButtonsMenu } from 'src/modules/preview-site/components/preview-action-buttons-menu';
import { ArrowIcon } from './arrow-icon';
import Button from './button';
import offlineIcon from './offline-icon';
import ProgressBar from './progress-bar';
import { ScreenshotDemoSite } from './screenshot-demo-site';
import { Tooltip } from './tooltip';

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

function DeletingRow() {
	const { __ } = useI18n();
	const { progress } = useProgressTimer( {
		paused: false,
		initialProgress: 60,
		interval: 1500,
		maxValue: 95,
	} );

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="w-[200px]">
						<div className="text-a8c-gray-70 a8c-body mb-4">{ __( 'Deleting preview link' ) }</div>
						<ProgressBar value={ progress } maxValue={ 100 } />
					</div>
				</div>
				<div className="flex ml-auto">
					<div className="w-[110px] text-[#757575] flex items-center pl-4">{ '-' }</div>
					<div className="w-[100px] text-[#757575] flex items-center pl-4">{ '-' }</div>
					<div className="w-[60px] pr-2" />
				</div>
			</div>
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
	const { countDown } = useExpirationDate( date );
	const { fetchSnapshotUsage } = useSnapshots();
	const { isDemoSiteUpdating } = useUpdateDemoSite();
	const isSiteDemoUpdating = isDemoSiteUpdating( snapshot.localSiteId, snapshot.atomicSiteId );
	const { formatRelativeTime } = useFormatLocalizedTimestamps();

	const getLastUpdateTimeText = () => {
		if ( ! date ) {
			return __( 'Never updated' );
		}
		const timeDistance = formatRelativeTime( new Date( date ).toISOString() );
		return sprintf( __( '%s ago' ), timeDistance );
	};

	useEffect( () => {
		fetchSnapshotUsage();
	}, [ fetchSnapshotUsage ] );

	const urlWithHTTPS = `https://${ url }`;

	if ( isDeleting ) {
		return <DeletingRow />;
	}

	return (
		<div className="self-stretch flex-col">
			<div className="flex items-center px-8 py-6">
				<div className="w-[51%]">
					<div className="flex items-center">
						<div className="text-[13px] leading-5 line-clamp-1 break-all">
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
					<div className="w-[110px] text-[#757575] flex items-center pl-4">
						{ isSiteDemoUpdating ? (
							<div className="flex items-center">
								<Spinner className="!mt-0 !mx-2" />
								{ __( 'Updating' ) }
							</div>
						) : (
							getLastUpdateTimeText()
						) }
					</div>
					<div className="w-[100px] text-[#757575] flex items-center pl-4">{ countDown }</div>
					<div className="w-[60px] flex justify-end">
						<PreviewActionButtonsMenu snapshot={ snapshot } selectedSite={ selectedSite } />
					</div>
				</div>
			</div>
		</div>
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

function PreviewLinksTableHeader() {
	const { __ } = useI18n();
	return (
		<div className="border-b border-a8c-gray-5">
			<div className="flex items-center h-12 px-8 text-gray-900 text-xs uppercase">
				<div className="w-[51%]">{ __( 'Preview link' ) }</div>
				<div className="flex ml-auto">
					<div className="w-[110px] flex items-center pl-4">
						{ __( 'Updated' ) }
						<Icon icon={ arrowDown } height={ 13 } width={ 16 } />
					</div>
					<div className="w-[100px] pl-4">{ __( 'Expires' ) }</div>
					<div className="w-[60px] text-right">{ __( 'Actions' ) }</div>
				</div>
			</div>
		</div>
	);
}

function LoadingRow( { isSnapshotLoading }: { isSnapshotLoading?: boolean } ) {
	const { __ } = useI18n();
	const { progress, setProgress } = useProgressTimer( {
		paused: ! isSnapshotLoading,
		initialProgress: 5,
		interval: 1500,
		maxValue: 95,
	} );

	useEffect( () => {
		if ( isSnapshotLoading ) {
			setProgress( 80 );
		}
	}, [ isSnapshotLoading, setProgress ] );

	return (
		<div className="flex items-center px-8 py-6">
			<div className="w-[51%]">
				<div className="w-[200px]">
					<div className="text-a8c-gray-70 a8c-body mb-4">{ __( 'Generating preview link' ) }</div>
					<ProgressBar value={ progress } maxValue={ 100 } />
				</div>
			</div>
			<div className="flex ml-auto">
				<div className="w-[110px] text-[#757575] flex items-center pl-4">{ __( 'Just now' ) }</div>
				<div className="w-[100px] text-[#757575] flex items-center pl-4">{ '-' }</div>
				<div className="w-[60px] pr-2" />
			</div>
		</div>
	);
}

export function ContentTabPreviews( { selectedSite }: ContentTabPreviewsProps ) {
	const { __ } = useI18n();
	const { snapshots } = useSnapshots();
	const { isAuthenticated } = useAuth();
	const { archiveSite, isUploadingSiteId } = useArchiveSite();
	const isUploading = isUploadingSiteId( selectedSite.id );

	if ( ! isAuthenticated ) {
		return <NoAuth selectedSite={ selectedSite } />;
	}

	const snapshotsOnSite = snapshots.filter(
		( snapshot ) => snapshot.localSiteId === selectedSite.id
	);

	if ( ! snapshotsOnSite.length ) {
		if ( isUploading ) {
			return (
				<div className="relative min-h-full flex flex-col">
					<div className="w-full flex flex-col flex-1">
						<div className="flex-1">
							<PreviewLinksTableHeader />
							<div className="[&>*:not(:last-child)]:border-b [&>*]:border-a8c-gray-5">
								{ isUploading && <LoadingRow isSnapshotLoading={ isUploading } /> }
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
		return <NoPreviews selectedSite={ selectedSite } />;
	}

	return (
		<div className="relative min-h-full flex flex-col">
			<div className="w-full flex flex-col flex-1">
				<div className="flex-1">
					<PreviewLinksTableHeader />
					<div className="[&>*:not(:last-child)]:border-b [&>*]:border-a8c-gray-5">
						{ isUploading && <LoadingRow isSnapshotLoading={ isUploading } /> }
						{ snapshotsOnSite.map( ( snapshot ) => (
							<SnapshotRow
								snapshot={ snapshot }
								previousSnapshot={ null }
								selectedSite={ selectedSite }
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
