import { DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { IllustrationGrid } from 'src/components/illustration-grid';
import offlineIcon from 'src/components/offline-icon';
import { ScreenshotDemoSite } from 'src/components/screenshot-demo-site';
import { Tooltip } from 'src/components/tooltip';
import { LIMIT_OF_ZIP_SITES_PER_USER } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteSize } from 'src/hooks/use-site-size';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CreatePreviewButton } from 'src/modules/preview-site/components/create-preview-button';
import { PreviewSiteRow } from 'src/modules/preview-site/components/preview-site-row';
import { PreviewSitesTableHeader } from 'src/modules/preview-site/components/preview-sites-table-header';
import { ProgressRow } from 'src/modules/preview-site/components/progress-row';
import { useUpdateButtonTooltip } from 'src/modules/preview-site/hooks/use-update-button-tooltip';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { snapshotSelectors, snapshotThunks } from 'src/stores/snapshot-slice';
import { useGetSnapshotUsage } from 'src/stores/wpcom-api';

interface ContentTabPreviewsProps {
	selectedSite: SiteDetails;
}

function EmptyGeneric( {
	children,
	selectedSite,
}: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="p-8 flex justify-between max-w-3xl gap-4 overflow-hidden">
			<div className="flex flex-col">
				<div className="a8c-subtitle mb-1">{ __( 'Share a preview of your Studio site' ) }</div>
				<div className="w-[40ch] text-frame-text-secondary a8c-body">
					{ __(
						'Get feedback from anyone, anywhere with a free hosted preview of your Studio site.'
					) }
				</div>
				<div className="mt-6">
					{ [
						sprintf( __( 'Create up to %d preview sites for free.' ), LIMIT_OF_ZIP_SITES_PER_USER ),
						/* translators: %d is the number of days before a preview site expires */
						sprintf(
							__( 'Preview sites expire %d days after the last update.' ),
							DEMO_SITE_EXPIRATION_DAYS
						),
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
							className="text-frame-text-secondary a8c-body flex items-center"
						>
							<Icon className="fill-frame-theme ltr:mr-2 rtl:ml-2 shrink-0" icon={ check } />
							{ text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<IllustrationGrid>
				<ScreenshotDemoSite site={ selectedSite } />
			</IllustrationGrid>
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
						<ArrowIcon />
					</Button>
				</Tooltip>
			</div>
			<div className="mt-3 w-[40ch] text-frame-text-secondary a8c-body">
				<Tooltip
					disabled={ ! isOffline }
					icon={ offlineIcon }
					text={ offlineMessage }
					placement="bottom-start"
				>
					<span>
						{ __( 'A WordPress.com account is required to create preview sites.' ) }{ ' ' }
						<Button
							aria-description={ isOffline ? offlineMessage : '' }
							aria-disabled={ isOffline }
							className="!p-0 text-frame-theme hover:opacity-80 h-auto inline-flex items-center"
							onClick={ () => {
								if ( isOffline ) {
									return;
								}
								getIpcApi().authenticate( true );
							} }
						>
							{ __( 'Create a free account' ) }
							<ArrowIcon />
						</Button>
					</span>
				</Tooltip>
			</div>
		</EmptyGeneric>
	);
}

function NoPreviews( { selectedSite }: React.ComponentProps< typeof EmptyGeneric > ) {
	const dispatch = useAppDispatch();
	const { user } = useAuth();

	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<div className="mt-8">
				<CreatePreviewButton
					onClick={ () => {
						void dispatch(
							snapshotThunks.createSnapshot( {
								siteFolder: selectedSite.path,
								siteId: selectedSite.id,
							} )
						);
					} }
					selectedSite={ selectedSite }
					user={ user }
				/>
			</div>
		</EmptyGeneric>
	);
}

export function ContentTabPreviews( { selectedSite }: ContentTabPreviewsProps ) {
	const dispatch = useAppDispatch();
	const { data: snapshotUsage } = useGetSnapshotUsage();
	const { isAuthenticated, user } = useAuth();
	const { isOverLimit } = useSiteSize( selectedSite.id );
	const activeOperation = useRootSelector( ( state ) =>
		snapshotSelectors.selectActiveCreateOperationForSite( state, selectedSite.id )
	);
	const snapshotsOnSite = useRootSelector( ( state ) =>
		snapshotSelectors.selectSnapshotsBySiteAndUser( state, selectedSite.id, user?.id ?? 0 )
	);
	const isAnySnapshotUpdating = useRootSelector( snapshotSelectors.selectIsAnySnapshotUpdating );
	const isOffline = useOffline();

	const isUpdateDisabled =
		isAnySnapshotUpdating || snapshotUsage?.siteCreationBlocked || isOverLimit || isOffline;

	const tooltipContent = useUpdateButtonTooltip( {
		snapshotCreationBlocked: snapshotUsage?.siteCreationBlocked ?? false,
		isOverLimit,
		isOffline,
	} );

	if ( ! isAuthenticated ) {
		return <NoAuth selectedSite={ selectedSite } />;
	}

	if ( ! snapshotsOnSite.length && ! activeOperation ) {
		return <NoPreviews selectedSite={ selectedSite } />;
	}

	return (
		<div className="relative min-h-full flex flex-col">
			<div className="w-full flex flex-col flex-1">
				<PreviewSitesTableHeader />
				<div className="[&>*:not(:last-child)]:border-b [&>*]:border-frame-border">
					{ activeOperation && (
						<ProgressRow text={ activeOperation.detail } progress={ activeOperation.progress } />
					) }
					{ snapshotsOnSite
						.sort( ( a, b ) => b.date - a.date )
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
					<div className="sticky bottom-0 bg-frame/[0.8] backdrop-blur-sm w-full px-8 py-6 mt-auto">
						<CreatePreviewButton
							onClick={ () => {
								void dispatch(
									snapshotThunks.createSnapshot( {
										siteFolder: selectedSite.path,
										siteId: selectedSite.id,
									} )
								);
							} }
							selectedSite={ selectedSite }
							user={ user }
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
