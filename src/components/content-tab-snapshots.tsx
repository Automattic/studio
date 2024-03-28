import { Popover, Spinner } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, check, external } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useEffect, useState } from 'react';
import { useArchiveSite } from '../hooks/use-archive-site';
import { useAuth } from '../hooks/use-auth';
import { useDeleteSnapshot } from '../hooks/use-delete-snapshot';
import { useExpirationDate } from '../hooks/use-expiration-date';
import { useProgressTimer } from '../hooks/use-progress-timer';
import { useSiteDetails } from '../hooks/use-site-details';
import { useSiteUsage } from '../hooks/use-site-usage';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { Badge } from './badge';
import Button from './button';
import ProgressBar from './progress-bar';
import { ScreenshotDemoSite } from './screenshot-demo-site';

interface ContentTabSnapshotsProps {
	selectedSite: SiteDetails;
}

function SnapshotRowLoading( { children }: PropsWithChildren ) {
	return (
		<div className="self-stretch px-4 py-3 flex items-center text-xs">
			<div className={ cx( 'flex mr-1.5 w-8/12 items-center text-a8c-gray-70' ) }>
				<Spinner className="!mt-0 !ml-0 !mr-2" />
				{ children }
			</div>
			<div className="w-28 pr-6 text-a8c-gray-70 whitespace-nowrap overflow-hidden truncate flex-1">
				-
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
	const { countDown, isExpired, dateString } = useExpirationDate( date );
	const { deleteSnapshot } = useDeleteSnapshot();

	if ( isDeleting ) {
		return <SnapshotRowLoading>{ __( 'Deleting demo site…' ) }</SnapshotRowLoading>;
	}
	const urlWithHTTPS = `https://${ url }`;
	if ( isExpired ) {
		return (
			<div className="self-stretch flex-col">
				<div
					className={ cx(
						'px-4 pt-3',
						'bg-a8c-gray-0 pb-4 border-b border-a8c-gray-5',
						'[&_.demo-site-name]:text-a8c-gray-50',
						'[&_.badge]:text-a8c-gray-50 [&_.badge]:bg-a8c-gray-5'
					) }
				>
					<div className="flex gap-2 items-center">
						<div className="text-black a8c-subtitle-small demo-site-name">
							{ selectedSite.name }
						</div>
						<Badge>{ __( 'Demo site' ) }</Badge>
					</div>
					<button
						className={ cx(
							'mt-1 !p-0 h-auto',
							'disabled:text-a8c-gray-50 disabled:cursor-not-allowed disabled:line-through'
						) }
						disabled
					>
						{ urlWithHTTPS }
					</button>
				</div>
				<div className="px-4 mt-4">
					<div className="text-black a8c-subtitle-small demo-site-name">
						{ sprintf( __( 'Site expired on %s' ), dateString ) }
					</div>
					<div className="a8c-body mt-1">
						{ __( 'Demo sites expire 7 days after they were last updated.' ) }
					</div>
				</div>
				<div className="px-4 pb-3 mt-4 flex gap-4">
					<AddDemoSiteWithProgress
						selectedSite={ selectedSite }
						isSnapshotLoading={ snapshot.isLoading }
						tagline={ __( "We're creating your new demo site." ) }
					/>
				</div>
			</div>
		);
	}
	return (
		<div className="self-stretch flex-col px-4 py-3">
			<div className="flex gap-2 items-center">
				<div className="text-black a8c-subtitle-small demo-site-name">{ selectedSite.name }</div>
				<Badge>{ __( 'Demo site' ) }</Badge>
			</div>
			<button
				className="mt-1 !p-0 h-auto text-a8c-blueberry cursor-pointer"
				onClick={ () => getIpcApi().openURL( urlWithHTTPS ) }
			>
				{ urlWithHTTPS }
			</button>
			<div className="mt-2 text-a8c-gray-70 whitespace-nowrap overflow-hidden truncate flex-1">
				{ sprintf( __( 'Expires in %s' ), countDown ) }
			</div>
			<div className="mt-4 flex gap-4">
				<Button variant="primary" onClick={ () => alert( 'Not implemented yet!' ) }>
					{ __( 'Update demo site' ) }
				</Button>
				<Button
					variant="secondary"
					className="!text-red-600 !hover:text-red-700"
					onClick={ () => deleteSnapshot( snapshot ) }
				>
					{ __( 'Delete demo site' ) }
				</Button>
			</div>
		</div>
	);
}

function EmptyGeneric( {
	children,
	selectedSite,
}: PropsWithChildren< { selectedSite: SiteDetails } > ) {
	const { __ } = useI18n();
	return (
		<div className="pb-10 flex justify-between">
			<div className="flex flex-col">
				<div className="a8c-subtitle mb-1">{ __( 'Share a demo site' ) }</div>
				<div className="w-[40ch] text-a8c-gray-70 a8c-body pr-2">
					{ createInterpolateElement(
						__(
							'Get feedback from anyone, anywhere with a free demo site powered by <a>WP Cloud</a>.'
						),
						{
							a: (
								<Button
									className="cursor-pointer !p-0 text-a8c-blueberry hover:opacity-80 h-auto"
									onClick={ () => getIpcApi().openURL( 'https://wp.cloud/' ) }
								/>
							),
						}
					) }
				</div>
				<div className="mt-6">
					{ [
						__( 'Share a hosted clone of your local site.' ),
						__( 'Push updates to your demo site at any time.' ),
						__( 'Demo sites expire 7 days after the last update.' ),
					].map( ( text ) => (
						<div key={ text } className="text-a8c-gray-70 a8c-body flex items-center">
							<Icon className="fill-a8c-blueberry mr-2" icon={ check } /> { text }
						</div>
					) ) }
				</div>
				{ children }
			</div>
			<div className="flex flex-col items-end">
				<ScreenshotDemoSite site={ selectedSite } />
			</div>
		</div>
	);
}

function NoAuth( { selectedSite }: React.ComponentProps< typeof EmptyGeneric > ) {
	const { __ } = useI18n();
	const { authenticate } = useAuth();

	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<div className="mt-8">
				<Button variant="primary" onClick={ authenticate }>
					{ __( 'Log in to WordPress.com' ) }
					<Icon className="ml-1" icon={ external } size={ 21 } />
				</Button>
			</div>
			<div className="mt-3 w-[40ch] text-a8c-gray-70 a8c-body">
				{ createInterpolateElement(
					__(
						'A WordPress.com account is required to create demo sites. <a>Create a free account</a>'
					),
					{
						a: (
							<Button
								className="cursor-pointer !p-0 text-a8c-blueberry hover:opacity-80 h-auto"
								onClick={ () =>
									getIpcApi().openURL( 'https://wordpress.com/start/account/user-social' )
								}
							/>
						),
					}
				) }
			</div>
		</EmptyGeneric>
	);
}

function NoSnapshots( {
	selectedSite,
	isSnapshotLoading,
}: React.ComponentProps< typeof EmptyGeneric > & { isSnapshotLoading?: boolean } ) {
	return (
		<EmptyGeneric selectedSite={ selectedSite }>
			<AddDemoSiteWithProgress
				className="mt-8"
				selectedSite={ selectedSite }
				isSnapshotLoading={ isSnapshotLoading }
			/>
		</EmptyGeneric>
	);
}

function AddDemoSiteWithProgress( {
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
	const { archiveSite, isUploadingSiteId } = useArchiveSite();
	const isUploading = isUploadingSiteId( selectedSite.id );
	const [ showPopover, setShowPopover ] = useState( false );
	const { siteLimit, siteCount, isLoading: isFetchingUsage } = useSiteUsage();
	const isLimitUsed = siteCount >= siteLimit;
	const { progress, setProgress } = useProgressTimer( {
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
		<div className={ className }>
			{ isUploading || isSnapshotLoading ? (
				<div className="w-[300px]">
					<ProgressBar value={ progress } maxValue={ 100 } />
					<div className="text-a8c-gray-70 a8c-body mt-4">
						{ tagline || __( "We're creating your demo site." ) }
					</div>
				</div>
			) : (
				<Button
					variant="primary"
					disabled={ isUploading || isFetchingUsage || isLimitUsed }
					onMouseOut={ () => setShowPopover( false ) }
					onMouseOver={ () => {
						if ( isLimitUsed ) {
							setShowPopover( true );
						}
					} }
					onClick={ () => archiveSite( selectedSite.id ) }
				>
					{ showPopover && (
						<Popover
							role="tooltip"
							noArrow={ true }
							position="top right"
							offset={ 8 }
							className="[&_div]:!shadow-none [&>div]:bg-transparent"
						>
							<div className="w-52 rounded-[4px] py-2 px-2.5 bg-[#101517] text-white leading-4 text-xs">
								{ sprintf(
									_n(
										"You've used %s demo site available on your account.",
										"You've used all %s demo sites available on your account.",
										siteLimit
									),
									siteLimit
								) }
							</div>
						</Popover>
					) }
					{ __( 'Add demo site' ) }
				</Button>
			) }
		</div>
	);
}

export function ContentTabSnapshots( { selectedSite }: ContentTabSnapshotsProps ) {
	const { __, _n } = useI18n();
	const { snapshots } = useSiteDetails();
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
		return <NoSnapshots selectedSite={ selectedSite } isSnapshotLoading={ snapshot?.isLoading } />;
	}
	return (
		<div className="pb-10">
			<div className="w-full rounded border border-a8c-gray-5">
				<SnapshotRow
					snapshot={ snapshot }
					previousSnapshot={ previousSnapshot }
					selectedSite={ selectedSite }
					key={ snapshot.atomicSiteId }
				/>
			</div>
		</div>
	);
}
