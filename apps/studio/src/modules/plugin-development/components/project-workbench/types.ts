import type {
	DevelopmentProjectAiPatch,
	DevelopmentProjectDirectory,
	DevelopmentProjectFile,
	DevelopmentProjectFileKind,
	DevelopmentProjectFileMode,
	DevelopmentProjectChatMessage,
	DevelopmentProjectValidationFinding,
} from '@studio/common/types/publishing';
import type { ButtonsSectionProps } from 'src/components/buttons-section';

export type WorkbenchSidebarTab = 'ai' | 'releases' | 'review';
export type ResizableWorkbenchColumn = 'explorer' | 'sidebar';
export type DirectoryExpansionOverrides = Record< string, boolean >;
export type ProjectOpenAction = ButtonsSectionProps[ 'buttonsArray' ][ number ];
export type DevelopmentProjectContextMenuAction = {
	action: 'add-ignore' | 'remove-ignore';
	projectId: string;
	path: string;
	kind: FileTreeEntry[ 'kind' ];
	ignoredBy?: string;
};
export type ExplorerValidationSummary = {
	error: number;
	warning: number;
	info: number;
	total: number;
	severity: DevelopmentProjectValidationFinding[ 'severity' ];
	firstMessage: string;
};
export type OpenFileTabFileKind = DevelopmentProjectFileKind | 'unsupported';
export type OpenFileTabMode = DevelopmentProjectFileMode | 'unsupported';
export type DiffLine = {
	type: 'context' | 'add' | 'delete';
	beforeNumber?: number;
	afterNumber?: number;
	text: string;
};
export type DiffHunkLine = {
	type: 'context' | 'add' | 'delete';
	content: string;
	oldNumber?: number;
	newNumber?: number;
};
export type DiffHunk = {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffHunkLine[];
};
export type AiPatchItem = DevelopmentProjectAiPatch & {
	id: string;
	source?: 'ai' | 'release';
	prompt?: string;
	createdAt: string;
	hunks?: DiffHunk[];
	additions?: number;
	deletions?: number;
};
export type DevelopmentChatMessage = DevelopmentProjectChatMessage;
export type DevelopmentChatExample = {
	id: string;
	label: string;
	prompt: string;
};
export type OpenFileTab = {
	path: string;
	savedContent: string;
	draftContent: string;
	fileKind: OpenFileTabFileKind;
	mediaType?: string;
	dataUrl?: string;
	editable: boolean;
	previewable: boolean;
	mode: OpenFileTabMode;
	isLoading: boolean;
	error?: string;
	unsupportedReason?: string;
};
export type FileTreeEntry =
	| ( {
			kind: 'directory';
			depth: number;
	  } & DevelopmentProjectDirectory )
	| ( {
			kind: 'file';
			depth: number;
	  } & DevelopmentProjectFile );
export type EditorRevealRequest = {
	path: string;
	line: number;
	column: number;
};
export type SyntaxToken = {
	text: string;
	className?: string;
};
