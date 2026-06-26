import { __, sprintf } from '@wordpress/i18n';
import { check, close } from '@wordpress/icons';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { AiPatchReviewEditor } from './ai-patch-review-editor';
import { getPatchStats } from './utils';
import type { AiPatchItem, DiffHunk } from './types';

type ReleaseReviewSidebarProps = {
	patches: AiPatchItem[];
	selectedPatch: AiPatchItem | null;
	selectedPatchHunks: DiffHunk[];
	reviewLabel: string | null;
	applyingPatchId: string | null;
	onSelectPatch: ( patchId: string ) => void;
	onAcceptPatch: ( patch: AiPatchItem ) => void;
	onRejectPatch: ( patch: AiPatchItem ) => void;
	onAcceptPatchHunk: ( patch: AiPatchItem, hunk: DiffHunk, hunkIndex: number ) => void;
	onRejectPatchHunk: ( patch: AiPatchItem, hunkIndex: number ) => void;
	onKeepAll: () => void;
};

export function ReleaseReviewSidebar( {
	patches,
	selectedPatch,
	selectedPatchHunks,
	reviewLabel,
	applyingPatchId,
	onSelectPatch,
	onAcceptPatch,
	onRejectPatch,
	onAcceptPatchHunk,
	onRejectPatchHunk,
	onKeepAll,
}: ReleaseReviewSidebarProps ) {
	const isApplying = Boolean( applyingPatchId );
	const changedFileCount = patches.length;
	const canKeepAll =
		changedFileCount > 0 && patches.every( ( patch ) => patch.source === 'release' );

	return (
		<div className={ cx( workbenchStyles.sidebarPane, workbenchStyles.reviewSidebarPane ) }>
			<div className={ workbenchStyles.sidebarSection }>
				<div className={ workbenchStyles.sectionHeader }>
					<h3>{ __( 'Review' ) }</h3>
					<span>
						{ sprintf(
							// translators: %d is the number of changed files.
							__( '%d files' ),
							changedFileCount
						) }
					</span>
				</div>
				{ reviewLabel && <p className={ workbenchStyles.patchPrompt }>{ reviewLabel }</p> }
				{ canKeepAll && (
					<div className={ workbenchStyles.sidebarActions }>
						<Button
							variant="secondary"
							icon={ check }
							iconSize={ 18 }
							disabled={ isApplying }
							onClick={ onKeepAll }
						>
							{ __( 'Keep all' ) }
						</Button>
					</div>
				) }
			</div>

			<div className={ cx( workbenchStyles.sidebarSection, workbenchStyles.reviewFilesSection ) }>
				<h3>{ __( 'Changed files' ) }</h3>
				{ patches.length === 0 ? (
					<div className={ workbenchStyles.emptyPane }>{ __( 'No changes need review.' ) }</div>
				) : (
					<div className={ workbenchStyles.patchList }>
						{ patches.map( ( patch ) => {
							const stats = getPatchStats( patch );
							const isPatchApplying = Boolean( applyingPatchId?.startsWith( patch.id ) );
							const acceptLabel = patch.source === 'release' ? __( 'Keep' ) : __( 'Accept' );
							const rejectLabel = patch.source === 'release' ? __( 'Revert' ) : __( 'Reject' );
							return (
								<div
									key={ patch.id }
									className={ cx(
										workbenchStyles.patchItem,
										selectedPatch?.id === patch.id && workbenchStyles.patchItemActive
									) }
								>
									<button
										type="button"
										className={ workbenchStyles.patchItemButton }
										onClick={ () => onSelectPatch( patch.id ) }
									>
										<span>
											<strong>{ patch.path }</strong>
											<em>{ patch.status }</em>
										</span>
										<small>
											+{ stats.added } -{ stats.deleted }
										</small>
									</button>
									<div className={ workbenchStyles.patchItemActions }>
										<Button
											variant="secondary"
											icon={ check }
											iconSize={ 16 }
											disabled={ isApplying }
											onClick={ () => onAcceptPatch( patch ) }
										>
											{ acceptLabel }
										</Button>
										<Button
											variant="secondary"
											icon={ close }
											iconSize={ 16 }
											disabled={ isPatchApplying }
											onClick={ () => onRejectPatch( patch ) }
										>
											{ isPatchApplying ? __( 'Applying…' ) : rejectLabel }
										</Button>
									</div>
								</div>
							);
						} ) }
					</div>
				) }
			</div>

			<div className={ workbenchStyles.reviewDiffSection }>
				{ selectedPatch ? (
					<AiPatchReviewEditor
						patch={ selectedPatch }
						hunks={ selectedPatchHunks }
						applyingPatchId={ applyingPatchId }
						variant="sidebar"
						onAcceptPatch={ onAcceptPatch }
						onRejectPatch={ onRejectPatch }
						onAcceptPatchHunk={ onAcceptPatchHunk }
						onRejectPatchHunk={ onRejectPatchHunk }
					/>
				) : (
					<div className={ workbenchStyles.emptyPane }>
						{ __( 'Select a changed file to review its diff.' ) }
					</div>
				) }
			</div>
		</div>
	);
}
