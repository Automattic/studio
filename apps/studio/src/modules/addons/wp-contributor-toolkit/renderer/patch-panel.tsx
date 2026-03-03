/**
 * Changed files list and patch generation panel for the WordPress Contributor Toolkit addon.
 */
import { __ } from '@wordpress/i18n';
import Button from 'src/components/button';
import { useContributorContext } from './contributor-context';
import type { WctSite } from '../types';

function FileStatusIndicator( { filepath }: { filepath: string } ) {
	// isomorphic-git statusMatrix entries: we show generic "modified" indicator
	return (
		<li className="flex items-center gap-2 py-1 text-sm font-mono">
			<span className="text-yellow-500 text-xs font-bold">M</span>
			<span className="text-gray-800 truncate">{ filepath }</span>
		</li>
	);
}

export function PatchPanel( { site }: { site: WctSite } ) {
	const { changedFiles, refreshChangedFiles, generatePatch } = useContributorContext();

	return (
		<div className="flex flex-col gap-6 p-6">
			<div className="flex gap-3 items-center">
				<Button
					variant="secondary"
					onClick={ () => {
						void refreshChangedFiles( site.id );
					} }
				>
					{ __( 'Refresh' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ () => {
						void generatePatch( site.id );
					} }
					disabled={ changedFiles.length === 0 }
				>
					{ __( 'Save .patch file' ) }
				</Button>
			</div>

			<div>
				<h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
					{ __( 'Changed Files' ) }
					{ changedFiles.length > 0 && (
						<span className="ms-2 text-gray-400">({ changedFiles.length })</span>
					) }
				</h3>

				{ changedFiles.length === 0 ? (
					<p className="text-sm text-gray-500">
						{ __( 'No changed files. Click Refresh to check for modifications.' ) }
					</p>
				) : (
					<ul className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-64 overflow-y-auto px-3">
						{ changedFiles.map( ( filepath ) => (
							<FileStatusIndicator key={ filepath } filepath={ filepath } />
						) ) }
					</ul>
				) }
			</div>
		</div>
	);
}
