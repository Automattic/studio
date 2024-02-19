import { MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { Icon, moreVertical, trash } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { useArchiveSite } from '../hooks/use-archive-site';
import { useAuth } from '../hooks/use-auth';
import { useDeleteSnapshot } from '../hooks/use-delete-snapshot';
import { useExpirationDate } from '../hooks/use-expiration-date';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { CopyTextButton } from './copy-text-button';
import { DropdownMenu } from './dropdown-menu';
import { EmptyLayout } from './empty-layout';

interface ContentTabSnapshotsProps {
	selectedSite: SiteDetails;
}

function SnapshotRowLoading( { children }: PropsWithChildren ) {
	return (
		<div className="self-stretch px-4 py-3 border-t border-a8c-gray-5 flex items-center text-xs">
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

function SnapshotRow( { snapshot }: { snapshot: Snapshot } ) {
	const { url, date, isLoading } = snapshot;
	const { countDown, isExpired } = useExpirationDate( date );
	const { deleteSnapshot } = useDeleteSnapshot();

	if ( isLoading ) {
		return <SnapshotRowLoading>{ __( 'Generating link…' ) }</SnapshotRowLoading>;
	}
	const urlWithHTTPS = `https://${ url }`;
	return (
		<div className="self-stretch px-4 py-3 border-t border-a8c-gray-5 flex items-center text-body">
			<div className="flex mr-1.5 w-8/12 items-center text-black text-black">
				<button
					className={ cx(
						'hover:text-blue-600 font-normal cursor-pointer leading-none',
						isExpired && 'text-a8c-gray-70 line-through cursor-not-allowed'
					) }
					disabled={ isExpired }
					onClick={ () => getIpcApi().openURL( urlWithHTTPS ) }
				>
					{ urlWithHTTPS }
				</button>
				{ ! isExpired && (
					<CopyTextButton text={ urlWithHTTPS } copyConfirmation={ __( 'Link copied' ) } />
				) }
			</div>
			<div className="w-28 pr-6 text-a8c-gray-70 whitespace-nowrap overflow-hidden truncate flex-1">
				{ countDown }
			</div>
			<DropdownMenu
				className="h-6 ml-auto flex items-center hover:text-blue-600"
				icon={ moreVertical }
				label={ __( 'More options' ) }
			>
				{ ( { onClose }: { onClose: () => void } ) => (
					<MenuGroup>
						<MenuItem
							className="text-red-600 hover:text-red-700"
							onClick={ () => {
								deleteSnapshot( snapshot );
								onClose();
							} }
						>
							<Icon className="mr-2" icon={ trash } /> { __( 'Delete preview link' ) }
						</MenuItem>
					</MenuGroup>
				) }
			</DropdownMenu>
		</div>
	);
}

function NoAuth() {
	const { __ } = useI18n();
	const { authenticate } = useAuth();

	return (
		<EmptyLayout footer={ __( 'Preview links expire after 7 days.' ) }>
			<EmptyLayout.Title>{ __( 'Share a preview of your site' ) }</EmptyLayout.Title>
			<EmptyLayout.Description>
				{ __( 'Create a hosted clone of your local site to get feedback from anyone, anywhere.' ) }
			</EmptyLayout.Description>
			<Button className="mt-6" variant="primary" onClick={ authenticate }>
				{ __( 'Log in to WordPress.com' ) }
			</Button>
		</EmptyLayout>
	);
}

export function ContentTabSnapshots( { selectedSite }: ContentTabSnapshotsProps ) {
	const { __, _n } = useI18n();
	const { snapshots } = useSiteDetails();
	const { archiveSite, isUploadingSiteId } = useArchiveSite();
	const isUploading = isUploadingSiteId( selectedSite.id );
	const { isAuthenticated } = useAuth();
	if ( ! isAuthenticated ) {
		return <NoAuth />;
	}
	const snapshotsOnSite = snapshots.filter(
		( snapshot ) => snapshot.localSiteId === selectedSite.id
	);
	const snapshotsOnSiteCount = snapshotsOnSite.length + ( isUploading ? 1 : 0 );
	return (
		<div className="pb-10">
			<div className="w-full justify-between items-center inline-flex">
				<div className="flex-col justify-start items-start gap-1 inline-flex">
					<div className="w-[45ch] text-a8c-gray-70 text-body font-normal pr-2">
						{ __(
							'Get feedback on your local site with a preview link. Links expire after 7 days.'
						) }
					</div>
				</div>
				<Button
					variant="primary"
					disabled={ isUploading || ! isAuthenticated }
					onClick={ () => archiveSite( selectedSite.id ) }
				>
					{ isUploading ? __( 'Creating preview link…' ) : __( 'Create preview link' ) }
				</Button>
			</div>
			<div className="w-full mt-8 rounded border border-a8c-gray-5 text-xxs">
				<div className="px-4 py-3.5 text-gray-800 font-medium uppercase flex flex-row justify-between">
					<span className="mr-1.5 w-8/12">
						{ sprintf(
							_n( '%d PREVIEW LINK', '%d PREVIEW LINKS', snapshotsOnSiteCount ),
							snapshotsOnSiteCount
						) }
					</span>
					{ snapshotsOnSiteCount > 0 && <span className="flex-auto">{ __( 'EXPIRES' ) }</span> }
				</div>
				{ isUploading && <SnapshotRowLoading>{ __( 'Uploading files…' ) }</SnapshotRowLoading> }
				{ snapshotsOnSite.map( ( snapshot ) => (
					<SnapshotRow snapshot={ snapshot } key={ snapshot.atomicSiteId } />
				) ) }
			</div>
		</div>
	);
}
