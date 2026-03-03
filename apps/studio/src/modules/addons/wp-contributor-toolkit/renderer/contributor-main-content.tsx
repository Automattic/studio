/**
 * Main content area for the WordPress Contributor Toolkit addon.
 */
import { TabPanel } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
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

function WorkspaceView( { site }: { site: WctSite } ) {
	const { openFolder } = useContributorContext();

	const tabs = [
		{ name: 'build', title: __( 'Build' ) },
		{ name: 'patch', title: __( 'Patch' ) },
	];

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<div className="px-6 pb-4 flex items-center gap-3">
				<div className="flex-1 min-w-0">
					<h1 className="text-xl font-semibold text-gray-900">{ site.name }</h1>
					<button
						type="button"
						className="text-xs text-a8c-blue-50 hover:underline truncate max-w-full text-left"
						onClick={ () => {
							void openFolder( site.repoPath );
						} }
					>
						{ site.repoPath }
					</button>
				</div>
			</div>

			<TabPanel
				className="h-full flex flex-col overflow-hidden"
				tabs={ tabs }
				orientation="horizontal"
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
