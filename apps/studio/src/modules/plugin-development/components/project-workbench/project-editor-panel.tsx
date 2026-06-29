import { __, sprintf } from '@wordpress/i18n';
import {
	Icon,
	cautionFilled,
	close,
	closeSmall,
	code,
	image as imageIcon,
	page as fileIcon,
} from '@wordpress/icons';
import { type RefObject } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { ImageFilePreview } from './image-file-preview';
import { MonacoFileEditor } from './monaco-file-editor';
import { ValidationProblemsPane } from './validation-problems-pane';
import type { AiPatchLineMapSide } from './monaco-highlighting';
import type { DiffHunk, EditorRevealRequest, OpenFileTab } from './types';
import type {
	DevelopmentProjectFile,
	DevelopmentProjectValidationFinding,
	DevelopmentProjectValidationResult,
} from '@studio/common/types/publishing';

function getOpenFilePreviewDataUrl( tab: OpenFileTab ) {
	if ( tab.mediaType === 'image/svg+xml' && tab.editable ) {
		return `data:${ tab.mediaType };charset=utf-8,${ encodeURIComponent( tab.draftContent ) }`;
	}

	return tab.dataUrl;
}

function getDisplayFileName( filePath: string ): string {
	return filePath.split( /[\\/]/ ).pop() || filePath;
}

type ProjectEditorPanelProps = {
	isBlocked: boolean;
	projectError?: string;
	isLoadingFiles: boolean;
	fileError: string | null;
	files: DevelopmentProjectFile[];
	openTabs: OpenFileTab[];
	selectedPath: string | null;
	selectedTab: OpenFileTab | undefined;
	selectedFile: DevelopmentProjectFile | undefined;
	selectedFilePatchHunks: DiffHunk[];
	selectedFilePatchSide: AiPatchLineMapSide;
	selectedFileFindings: DevelopmentProjectValidationFinding[];
	preferredProjectFile: DevelopmentProjectFile | undefined;
	revealRequest: EditorRevealRequest | null;
	isLoadingFile: boolean;
	hasUnsavedChanges: boolean;
	isSaving: boolean;
	selectedTabCanEdit: boolean;
	selectedTabCanPreview: boolean;
	activeDraftContent: string;
	editorTabsListRef: RefObject< HTMLDivElement | null >;
	setEditorTabRef: ( filePath: string ) => ( element: HTMLDivElement | null ) => void;
	setEditorTabButtonRef: ( filePath: string ) => ( element: HTMLButtonElement | null ) => void;
	validationResult: DevelopmentProjectValidationResult | null;
	isValidatingProject: boolean;
	onSelectOpenTab: ( filePath: string ) => void;
	onCloseFileTab: ( filePath: string ) => void;
	onOpenFileTab: ( filePath: string ) => void;
	onSelectFileMode: ( mode: OpenFileTab[ 'mode' ] ) => void;
	onUpdateOpenTab: ( filePath: string, updater: ( tab: OpenFileTab ) => OpenFileTab ) => void;
	onSave: () => void;
	onRunValidation: () => void;
	onOpenFinding: ( finding: DevelopmentProjectValidationFinding ) => void;
};

export function ProjectEditorPanel( {
	isBlocked,
	projectError,
	isLoadingFiles,
	fileError,
	files,
	openTabs,
	selectedPath,
	selectedTab,
	selectedFile,
	selectedFilePatchHunks,
	selectedFilePatchSide,
	selectedFileFindings,
	preferredProjectFile,
	revealRequest,
	isLoadingFile,
	hasUnsavedChanges,
	isSaving,
	selectedTabCanEdit,
	selectedTabCanPreview,
	activeDraftContent,
	editorTabsListRef,
	setEditorTabRef,
	setEditorTabButtonRef,
	validationResult,
	isValidatingProject,
	onSelectOpenTab,
	onCloseFileTab,
	onOpenFileTab,
	onSelectFileMode,
	onUpdateOpenTab,
	onSave,
	onRunValidation,
	onOpenFinding,
}: ProjectEditorPanelProps ) {
	const selectedPreviewDataUrl = selectedTab ? getOpenFilePreviewDataUrl( selectedTab ) : undefined;

	const renderEditorBody = () => {
		if ( ! selectedPath ) {
			return (
				<div className={ workbenchStyles.editorPlaceholder }>
					<Icon icon={ fileIcon } size={ 32 } />
					<div>
						<h2>{ isLoadingFiles ? __( 'Loading files…' ) : __( 'No file open' ) }</h2>
						<p>
							{ isLoadingFiles
								? __( 'Studio is reading this plugin project.' )
								: __( 'Select a file from Explorer, or open the main plugin file.' ) }
						</p>
					</div>
					{ ! isLoadingFiles && preferredProjectFile && (
						<Button
							variant="secondary"
							icon={ fileIcon }
							iconSize={ 18 }
							onClick={ () => onOpenFileTab( preferredProjectFile.path ) }
						>
							{ __( 'Open main file' ) }
						</Button>
					) }
				</div>
			);
		}

		if ( selectedTab?.fileKind === 'unsupported' ) {
			return (
				<div className={ workbenchStyles.editorPlaceholder }>
					<Icon icon={ cautionFilled } size={ 32 } />
					<div>
						<h2>
							{ sprintf(
								// translators: %s is the file name.
								__( 'Cannot open %s' ),
								getDisplayFileName( selectedPath )
							) }
						</h2>
						<p>
							{ selectedTab.unsupportedReason ??
								__(
									'Binary, archive, and oversized files are kept in the project, but Studio does not open them in the editor.'
								) }
						</p>
					</div>
					<Button
						variant="secondary"
						icon={ close }
						iconSize={ 18 }
						onClick={ () => onCloseFileTab( selectedPath ) }
					>
						{ __( 'Close tab' ) }
					</Button>
				</div>
			);
		}

		if ( selectedTab?.previewable && selectedTab.mode === 'preview' ) {
			return (
				<ImageFilePreview
					path={ selectedPath }
					dataUrl={ selectedPreviewDataUrl }
					mediaType={ selectedTab.mediaType }
					size={ selectedFile?.size }
				/>
			);
		}

		if ( selectedTab && ! selectedTab.editable ) {
			return (
				<div className={ workbenchStyles.editorPlaceholder }>
					<Icon icon={ imageIcon } size={ 32 } />
					<div>
						<h2>{ __( 'Preview-only file' ) }</h2>
						<p>{ __( 'This image can be previewed in Studio, but it cannot be edited here.' ) }</p>
					</div>
					<Button
						variant="secondary"
						icon={ imageIcon }
						iconSize={ 18 }
						onClick={ () => onSelectFileMode( 'preview' ) }
					>
						{ __( 'Show preview' ) }
					</Button>
				</div>
			);
		}

		return (
			<MonacoFileEditor
				disabled={ isBlocked || ! selectedPath || ! selectedTabCanEdit }
				isLoading={ isLoadingFile }
				path={ selectedPath }
				revealRequest={ revealRequest }
				aiPatchSide={ selectedFilePatchSide }
				aiPatchHunks={ selectedFilePatchHunks }
				validationFindings={ selectedFileFindings }
				value={ activeDraftContent }
				onChange={ ( value ) => {
					if ( ! selectedPath || ! selectedTab?.editable ) {
						return;
					}
					onUpdateOpenTab( selectedPath, ( tab ) => ( { ...tab, draftContent: value } ) );
				} }
				onSave={ () => {
					if ( selectedTab?.editable ) {
						onSave();
					}
				} }
			/>
		);
	};

	return (
		<section className={ workbenchStyles.editorPanel }>
			{ isBlocked && (
				<div className={ workbenchStyles.errorBanner }>
					<Icon icon={ cautionFilled } size={ 20 } />
					<div>
						<strong>{ __( 'Studio cannot prepare this project yet.' ) }</strong>
						<span>{ projectError }</span>
					</div>
				</div>
			) }
			<div className={ workbenchStyles.editorTabs }>
				<div ref={ editorTabsListRef } className={ workbenchStyles.editorTabsList }>
					{ openTabs.map( ( tab ) => {
						const file = files.find( ( item ) => item.path === tab.path );
						const isActive = selectedPath === tab.path;
						const isDirty = tab.draftContent !== tab.savedContent;
						const tabFileKind = file?.fileKind || tab.fileKind;
						return (
							<div
								key={ tab.path }
								ref={ setEditorTabRef( tab.path ) }
								className={ cx(
									workbenchStyles.editorTab,
									isActive && workbenchStyles.editorTabActive
								) }
							>
								<button
									type="button"
									ref={ setEditorTabButtonRef( tab.path ) }
									className={ workbenchStyles.editorTabButton }
									onClick={ () => onSelectOpenTab( tab.path ) }
								>
									<Icon
										icon={
											tabFileKind === 'unsupported'
												? cautionFilled
												: tabFileKind === 'image'
												? imageIcon
												: fileIcon
										}
										size={ 16 }
									/>
									<span>{ file?.name || getDisplayFileName( tab.path ) }</span>
									{ isDirty && <small>•</small> }
								</button>
								<button
									type="button"
									className={ workbenchStyles.editorTabClose }
									aria-label={ __( 'Close file' ) }
									onClick={ ( event ) => {
										event.stopPropagation();
										onCloseFileTab( tab.path );
									} }
								>
									<Icon icon={ closeSmall } size={ 16 } />
								</button>
							</div>
						);
					} ) }
				</div>
				<div className={ workbenchStyles.editorToolbar }>
					{ selectedTabCanPreview && selectedTabCanEdit && (
						<>
							<Button
								variant={ selectedTab?.mode === 'preview' ? 'primary' : 'secondary' }
								icon={ imageIcon }
								iconSize={ 18 }
								onClick={ () => onSelectFileMode( 'preview' ) }
								aria-pressed={ selectedTab?.mode === 'preview' }
							>
								{ __( 'Preview' ) }
							</Button>
							<Button
								variant={ selectedTab?.mode === 'code' ? 'primary' : 'secondary' }
								icon={ code }
								iconSize={ 18 }
								onClick={ () => onSelectFileMode( 'code' ) }
								aria-pressed={ selectedTab?.mode === 'code' }
							>
								{ __( 'Code' ) }
							</Button>
						</>
					) }
					<Button
						variant="primary"
						disabled={
							! selectedPath || ! selectedTabCanEdit || ! hasUnsavedChanges || isSaving || isBlocked
						}
						onClick={ onSave }
					>
						{ isSaving ? __( 'Saving…' ) : __( 'Save' ) }
					</Button>
				</div>
			</div>
			{ fileError && <div className={ workbenchStyles.editorError }>{ fileError }</div> }
			{ selectedTab?.error && (
				<div className={ workbenchStyles.editorError }>{ selectedTab.error }</div>
			) }
			<div className={ workbenchStyles.editorBody }>{ renderEditorBody() }</div>
			<ValidationProblemsPane
				validationResult={ validationResult }
				isBlocked={ isBlocked }
				isValidatingProject={ isValidatingProject }
				onRunValidation={ onRunValidation }
				onOpenFinding={ onOpenFinding }
			/>
		</section>
	);
}
