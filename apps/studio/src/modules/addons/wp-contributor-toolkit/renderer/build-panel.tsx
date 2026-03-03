/**
 * Build controls and log stream panel for the WordPress Contributor Toolkit addon.
 */
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import Button from 'src/components/button';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useContributorContext } from './contributor-context';
import type { WctSite } from '../types';

function StudioSiteSection( { site }: { site: WctSite } ) {
	const { sites, startServer, stopServer, loadingServer } = useSiteDetails();

	// siteId is always set now (auto-created on add), but guard for in-progress creation
	if ( ! site.siteId ) {
		return (
			<div className="flex flex-col gap-2">
				<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
					{ __( 'Site' ) }
				</h3>
				<p className="text-xs text-gray-500">{ __( 'Setting up Studio site…' ) }</p>
			</div>
		);
	}

	const studioSite = sites.find( ( s ) => s.id === site.siteId );
	const isRunning = studioSite?.running ?? false;
	const isLoading = loadingServer[ site.siteId ] ?? false;

	return (
		<div className="flex flex-col gap-2">
			<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
				{ __( 'Site' ) }
			</h3>
			<div className="flex items-center gap-3 flex-wrap">
				{ isRunning ? (
					<Button
						variant="secondary"
						onClick={ () => {
							void stopServer( site.siteId! );
						} }
						isBusy={ isLoading }
						disabled={ isLoading }
					>
						{ __( 'Stop' ) }
					</Button>
				) : (
					<Button
						variant="primary"
						onClick={ () => {
							if ( studioSite ) {
								void startServer( studioSite );
							}
						} }
						isBusy={ isLoading }
						disabled={ isLoading || ! studioSite }
					>
						{ __( 'Start' ) }
					</Button>
				) }

				{ isRunning && (
					<Button
						variant="secondary"
						onClick={ () => {
							getIpcApi().openSiteURL( site.siteId!, '', { autoLogin: false } );
						} }
					>
						{ __( 'Open in Browser' ) }
					</Button>
				) }

				{ isRunning && (
					<span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
						<span className="w-2 h-2 rounded-full bg-[#1ED15A] border border-[#00BA37]" />
						{ __( 'Running' ) }
					</span>
				) }
			</div>
		</div>
	);
}

export function BuildPanel( { site }: { site: WctSite } ) {
	const { logLines, runInstall, runBuild, startWatch, stopWatch } = useContributorContext();
	const logRef = useRef< HTMLPreElement >( null );

	const installStatus = site.installStatus;
	const buildStatus = site.buildStatus;
	const watchStatus = site.watchStatus;

	// Auto-scroll to bottom when new log lines arrive
	useEffect( () => {
		if ( logRef.current ) {
			logRef.current.scrollTop = logRef.current.scrollHeight;
		}
	}, [ logLines ] );

	const isInstalling = installStatus === 'running';
	const isBuilding = buildStatus === 'running';
	const isWatching = watchStatus === 'running';
	const isBusy = isInstalling || isBuilding || isWatching;

	return (
		<div className="flex flex-col gap-6 p-6">
			<StudioSiteSection site={ site } />

			<div className="flex flex-wrap gap-3 items-center">
				<div className="flex items-center gap-1.5">
					<Button
						variant="secondary"
						onClick={ () => {
							void runInstall( site.id );
						} }
						disabled={ isBusy }
						isBusy={ isInstalling }
					>
						{ __( 'npm install' ) }
					</Button>
					{ installStatus === 'success' && (
						<span className="text-sm text-green-600">{ __( '✓' ) }</span>
					) }
					{ installStatus === 'error' && (
						<span className="text-sm text-red-600">{ __( '✗' ) }</span>
					) }
				</div>

				<div className="flex items-center gap-1.5">
					<Button
						variant="secondary"
						onClick={ () => {
							void runBuild( site.id );
						} }
						disabled={ isBusy }
						isBusy={ isBuilding }
					>
						{ __( 'Build' ) }
					</Button>
					{ buildStatus === 'success' && (
						<span className="text-sm text-green-600">{ __( '✓' ) }</span>
					) }
					{ buildStatus === 'error' && <span className="text-sm text-red-600">{ __( '✗' ) }</span> }
				</div>

				{ isWatching ? (
					<Button
						variant="secondary"
						onClick={ () => {
							void stopWatch( site.id );
						} }
					>
						{ __( 'Stop Watch' ) }
					</Button>
				) : (
					<Button
						variant="secondary"
						onClick={ () => {
							void startWatch( site.id );
						} }
						disabled={ isBusy }
					>
						{ __( 'Start Watch' ) }
					</Button>
				) }

				{ isWatching && (
					<span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
						<span className="w-2 h-2 rounded-full bg-[#1ED15A] border border-[#00BA37]" />
						{ __( 'Watch running' ) }
					</span>
				) }
			</div>

			<div>
				<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
					{ __( 'Output' ) }
				</h3>
				<pre
					ref={ logRef }
					className="bg-gray-900 text-gray-100 text-xs font-mono p-4 rounded-md h-64 overflow-y-auto whitespace-pre-wrap break-words"
					style={ { scrollbarWidth: 'thin' } }
				>
					{ logLines.length === 0 ? (
						<span className="text-gray-500">{ __( 'Output will appear here…' ) }</span>
					) : (
						logLines.join( '\n' )
					) }
				</pre>
			</div>
		</div>
	);
}
