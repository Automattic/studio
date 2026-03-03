/**
 * Main content area for the WordPress Contributor Toolkit addon.
 */
import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useState } from 'react';
import { ActionButton } from 'src/components/action-button';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { BuildPanel } from './build-panel';
import { useContributorContext } from './contributor-context';
import { PatchPanel } from './patch-panel';
import type { WctSite } from '../types';

function CloneProgressView() {
	const { cloneProgress } = useContributorContext();

	const progressPercent =
		cloneProgress && cloneProgress.total > 0
			? Math.round( ( cloneProgress.loaded / cloneProgress.total ) * 100 )
			: null;

	return (
		<div className="flex flex-col items-center justify-center h-full app-no-drag-region gap-6 px-8">
			<div className="w-full max-w-sm text-center">
				<div className="mb-4">
					<div className="inline-block w-8 h-8 border-2 border-a8c-blue-50 border-t-transparent rounded-full animate-spin" />
				</div>
				<h2 className="text-lg font-medium text-gray-900 mb-2">
					{ __( 'Cloning wordpress-develop…' ) }
				</h2>
				{ cloneProgress && <p className="text-sm text-gray-600 mb-3">{ cloneProgress.phase }</p> }
				{ progressPercent !== null && (
					<div className="w-full bg-gray-200 rounded-full h-2">
						<div
							className="bg-a8c-blue-50 h-2 rounded-full transition-all"
							style={ { width: `${ progressPercent }%` } }
						/>
					</div>
				) }
			</div>
		</div>
	);
}

function ErrorView( { site }: { site: WctSite } ) {
	const { clone, openFolder } = useContributorContext();

	return (
		<div className="flex flex-col items-center justify-center h-full app-no-drag-region gap-4 px-8">
			<div className="text-center">
				<h2 className="text-lg font-medium text-gray-900 mb-2">{ __( 'Something went wrong' ) }</h2>
				<p className="text-sm text-gray-600 mb-4">
					{ __( 'Failed to set up the repository. Try again or open the folder.' ) }
				</p>
				<div className="flex gap-3 justify-center">
					<button
						type="button"
						className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
						onClick={ () => {
							void clone( site.id, site.repoPath );
						} }
					>
						{ __( 'Retry Clone' ) }
					</button>
					<button
						type="button"
						className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
						onClick={ () => {
							void openFolder( site.repoPath );
						} }
					>
						{ __( 'Open Folder' ) }
					</button>
				</div>
			</div>
		</div>
	);
}

function ContributorHeader( { site }: { site: WctSite } ) {
	const { openFolder, removeSite } = useContributorContext();
	const { sites, startServer, stopServer, loadingServer } = useSiteDetails();
	const [ confirmDelete, setConfirmDelete ] = useState( false );

	const studioSite = site.siteId ? sites.find( ( s ) => s.id === site.siteId ) : null;
	const isRunning = studioSite?.running ?? false;
	const isLoading = site.siteId ? loadingServer[ site.siteId ] ?? false : false;

	const handleToggle = () => {
		if ( isRunning ) {
			void stopServer( site.siteId! );
		} else if ( studioSite ) {
			void startServer( studioSite );
		}
	};

	const handleOpenSite = () => {
		if ( studioSite?.running && studioSite.url ) {
			getIpcApi().openURL( studioSite.url );
		}
	};

	const handleDelete = () => {
		void removeSite( site.id );
	};

	return (
		<div className="flex flex-col w-full gap-2">
			<div className="flex justify-between items-start w-full gap-5 px-8">
				<div className="flex flex-col">
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all">{ site.name }</h1>
					<div className="flex mt-1 gap-x-4">
						<Button
							className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blue-50 !px-0 h-0 leading-4"
							onClick={ () => {
								void openFolder( site.repoPath );
							} }
							variant="link"
						>
							{ __( 'Open folder' ) }
							<ArrowIcon />
						</Button>
						{ studioSite?.running && (
							<Button
								className="[&.is-link]:text-a8c-gray-70 [&.is-link]:hover:text-a8c-blue-50 !px-0 h-0 leading-4"
								onClick={ handleOpenSite }
								variant="link"
							>
								{ __( 'Open site' ) }
								<ArrowIcon />
							</Button>
						) }
					</div>
				</div>
				<div className="flex items-center gap-2 flex-shrink-0">
					{ confirmDelete ? (
						<div className="flex items-center gap-2">
							<span className="text-xs text-gray-600">{ __( 'Delete this site?' ) }</span>
							<Button variant="secondary" onClick={ handleDelete }>
								{ __( 'Delete' ) }
							</Button>
							<Button
								variant="secondary"
								onClick={ () => {
									setConfirmDelete( false );
								} }
							>
								{ __( 'Cancel' ) }
							</Button>
						</div>
					) : (
						<Button
							variant="secondary"
							onClick={ () => {
								setConfirmDelete( true );
							} }
						>
							{ __( 'Delete' ) }
						</Button>
					) }
					{ site.siteId && (
						<ActionButton
							isRunning={ isRunning }
							isLoading={ isLoading }
							onClick={ handleToggle }
							disabled={ ! studioSite && ! isRunning }
							buttonLabelOnDisabled={ __( 'Setting up…' ) }
						/>
					) }
				</div>
			</div>
		</div>
	);
}

function WorkspaceView( { site }: { site: WctSite } ) {
	const tabs = [
		{ name: 'build', title: __( 'Develop' ) },
		{ name: 'patch', title: __( 'Patch' ) },
	];

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<ContributorHeader site={ site } />

			<TabPanel
				className="mt-6 h-full flex flex-col overflow-hidden"
				tabs={ tabs }
				orientation="horizontal"
				key={ site.id }
			>
				{ ( { name } ) => (
					<div className="h-full overflow-y-auto" style={ { scrollbarWidth: 'thin' } }>
						{ name === 'build' && <BuildPanel site={ site } /> }
						{ name === 'patch' && <PatchPanel site={ site } /> }
					</div>
				) }
			</TabPanel>
		</div>
	);
}

export function ContributorWorkspace() {
	const { sites, activeSite } = useContributorContext();

	if ( sites.length === 0 ) {
		return (
			<div className="flex flex-col items-center justify-center h-full app-no-drag-region px-8 text-center">
				<p className="text-sm text-gray-500">
					{ __( 'Add your first WP contribution site from the Add Site menu.' ) }
				</p>
			</div>
		);
	}

	if ( ! activeSite ) {
		return (
			<div className="flex flex-col items-center justify-center h-full app-no-drag-region px-8 text-center">
				<p className="text-sm text-gray-500">{ __( 'Select a site from the sidebar.' ) }</p>
			</div>
		);
	}

	if ( activeSite.repoStatus === 'cloning' ) {
		return <CloneProgressView />;
	}

	if ( activeSite.repoStatus === 'error' ) {
		return <ErrorView site={ activeSite } />;
	}

	return <WorkspaceView site={ activeSite } />;
}
