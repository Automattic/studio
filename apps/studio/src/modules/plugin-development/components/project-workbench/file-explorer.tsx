import { __, sprintf } from '@wordpress/i18n';
import {
	chevronDown,
	chevronRight,
	file as folderIcon,
	image as imageIcon,
	page as fileIcon,
	Icon,
} from '@wordpress/icons';
import { type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { cx } from 'src/lib/cx';
import workbenchStyles from '../development-workbench.module.css';
import { getExplorerValidationTitle } from './explorer-validation';
import { formatFileSize } from './utils';
import type {
	DirectoryExpansionOverrides,
	ExplorerValidationSummary,
	FileTreeEntry,
	ResizableWorkbenchColumn,
} from './types';

type FileExplorerProps = {
	fileEntries: FileTreeEntry[];
	visibleFileEntries: FileTreeEntry[];
	isLoadingFiles: boolean;
	selectedPath: string | null;
	directoryExpansionOverrides: DirectoryExpansionOverrides;
	explorerValidationSummaries: Map< string, ExplorerValidationSummary >;
	resizingColumn: ResizableWorkbenchColumn | null;
	onSelectFile: ( filePath: string ) => void;
	onToggleDirectoryExpansion: ( entry: Extract< FileTreeEntry, { kind: 'directory' } > ) => void;
	onContextMenu: ( event: MouseEvent, entry: FileTreeEntry ) => void;
	onResizePointerDown: (
		column: ResizableWorkbenchColumn,
		event: PointerEvent< HTMLButtonElement >
	) => void;
	onResizeKeyDown: (
		column: ResizableWorkbenchColumn,
		event: KeyboardEvent< HTMLButtonElement >
	) => void;
	onResetExplorerWidth: () => void;
};

export function FileExplorer( {
	fileEntries,
	visibleFileEntries,
	isLoadingFiles,
	selectedPath,
	directoryExpansionOverrides,
	explorerValidationSummaries,
	resizingColumn,
	onSelectFile,
	onToggleDirectoryExpansion,
	onContextMenu,
	onResizePointerDown,
	onResizeKeyDown,
	onResetExplorerWidth,
}: FileExplorerProps ) {
	return (
		<aside className={ workbenchStyles.explorer }>
			<div className={ workbenchStyles.panelHeader }>
				<span>{ __( 'Explorer' ) }</span>
				{ isLoadingFiles && <span>{ __( 'Loading…' ) }</span> }
			</div>
			<div className={ workbenchStyles.fileTree }>
				{ fileEntries.length === 0 && ! isLoadingFiles ? (
					<div className={ workbenchStyles.emptyPane }>{ __( 'No files found' ) }</div>
				) : (
					visibleFileEntries.map( ( entry ) => {
						const validationSummary = explorerValidationSummaries.get( entry.path );
						const validationTitle = validationSummary
							? getExplorerValidationTitle( validationSummary )
							: undefined;
						const validationBadge = validationSummary ? (
							<span
								className={ cx(
									workbenchStyles.explorerValidationBadge,
									validationSummary.severity === 'error' &&
										workbenchStyles.explorerValidationBadgeError,
									validationSummary.severity === 'warning' &&
										workbenchStyles.explorerValidationBadgeWarning,
									validationSummary.severity === 'info' &&
										workbenchStyles.explorerValidationBadgeInfo
								) }
								title={ validationTitle }
								aria-label={ sprintf(
									// translators: %d is the number of validation findings for this file or folder.
									__( '%d validation findings' ),
									validationSummary.total
								) }
							>
								{ validationSummary.total }
							</span>
						) : null;
						const validationClassName = validationSummary
							? cx(
									validationSummary.severity === 'error' &&
										workbenchStyles.explorerRowValidationError,
									validationSummary.severity === 'warning' &&
										workbenchStyles.explorerRowValidationWarning,
									validationSummary.severity === 'info' && workbenchStyles.explorerRowValidationInfo
							  )
							: undefined;

						return entry.kind === 'directory' ? (
							<button
								key={ `directory:${ entry.path }` }
								type="button"
								className={ cx(
									workbenchStyles.directoryRow,
									validationClassName,
									entry.ignored && workbenchStyles.fileRowIgnored
								) }
								style={ { paddingLeft: `${ 10 + entry.depth * 14 }px` } }
								aria-expanded={ directoryExpansionOverrides[ entry.path ] ?? ! entry.ignored }
								onClick={ () => onToggleDirectoryExpansion( entry ) }
								onContextMenu={ ( event ) => onContextMenu( event, entry ) }
								title={ validationTitle }
							>
								<Icon
									icon={
										directoryExpansionOverrides[ entry.path ] ?? ! entry.ignored
											? chevronDown
											: chevronRight
									}
									size={ 16 }
								/>
								<Icon icon={ folderIcon } size={ 16 } />
								<span>{ entry.name }</span>
								{ ( validationBadge || entry.ignored ) && (
									<span className={ workbenchStyles.explorerRowMeta }>
										{ validationBadge }
										{ entry.ignored && <small>{ __( 'ignored' ) }</small> }
									</span>
								) }
							</button>
						) : (
							<button
								key={ `file:${ entry.path }` }
								type="button"
								className={ cx(
									workbenchStyles.fileRow,
									selectedPath === entry.path && workbenchStyles.fileRowActive,
									validationClassName,
									entry.ignored && workbenchStyles.fileRowIgnored
								) }
								style={ { paddingLeft: `${ 10 + entry.depth * 14 }px` } }
								onClick={ () => onSelectFile( entry.path ) }
								onContextMenu={ ( event ) => onContextMenu( event, entry ) }
								title={ validationTitle }
							>
								<span className={ workbenchStyles.explorerChevronSpacer } aria-hidden="true" />
								<Icon icon={ entry.fileKind === 'image' ? imageIcon : fileIcon } size={ 16 } />
								<span>{ entry.name }</span>
								<span className={ workbenchStyles.explorerRowMeta }>
									{ validationBadge }
									<small>{ entry.ignored ? __( 'ignored' ) : formatFileSize( entry.size ) }</small>
								</span>
							</button>
						);
					} )
				) }
			</div>
			<button
				type="button"
				className={ cx(
					workbenchStyles.resizeHandle,
					workbenchStyles.resizeHandleExplorer,
					resizingColumn === 'explorer' && workbenchStyles.resizeHandleActive
				) }
				aria-label={ __( 'Resize file explorer' ) }
				title={ __( 'Resize file explorer' ) }
				onPointerDown={ ( event ) => onResizePointerDown( 'explorer', event ) }
				onDoubleClick={ onResetExplorerWidth }
				onKeyDown={ ( event ) => onResizeKeyDown( 'explorer', event ) }
			/>
		</aside>
	);
}
