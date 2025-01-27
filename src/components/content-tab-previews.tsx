import { createInterpolateElement } from '@wordpress/element';
import { check, external, Icon } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { CLIENT_ID, PROTOCOL_PREFIX, SCOPES, WP_AUTHORIZE_ENDPOINT } from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSnapshots } from 'src/hooks/use-snapshots';
import { getIpcApi } from 'src/lib/get-ipc-api';
import Button from './button';
import offlineIcon from './offline-icon';
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

function NoPreviews( {
	selectedSite,
	isSnapshotLoading,
}: React.ComponentProps< typeof EmptyGeneric > & { isSnapshotLoading?: boolean } ) {
	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			{ /* <AddDemoSiteWithProgress
				className="mt-8"
				selectedSite={ selectedSite }
				isSnapshotLoading={ isSnapshotLoading }
			/> */ }
		</EmptyGeneric>
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
	// return (
	// <div className="p-8">
	// 	<div className="w-full rounded border border-a8c-gray-5">
	// 		<SnapshotRow
	// 			snapshot={ snapshot }
	// 			previousSnapshot={ previousSnapshot }
	// 			selectedSite={ selectedSite }
	// 			key={ snapshot.atomicSiteId }
	// 		/>
	// 	</div>
	// </div>
	// );
}
