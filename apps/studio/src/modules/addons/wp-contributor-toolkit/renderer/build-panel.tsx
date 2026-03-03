/**
 * Build controls and log stream panel for the WordPress Contributor Toolkit addon.
 */
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import Button from 'src/components/button';
import { useContributorContext } from './contributor-context';
import type { WctSite } from '../types';

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
						{ __( 'Install dependencies' ) }
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
						{ __( 'Stop watch' ) }
					</Button>
				) : (
					<Button
						variant="secondary"
						onClick={ () => {
							void startWatch( site.id );
						} }
						disabled={ isBusy }
					>
						{ __( 'Start watch' ) }
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
