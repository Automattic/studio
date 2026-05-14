import { createContext, useContext } from 'react';
import type { DeskConfig } from '../types';
import type { Annotation } from '@/components/site-preview/types';
import type {
	DeskWidgetConnectionTarget,
	SelectedDeskConnectorToolbarItem,
} from '@/ui-desks/connectors/utils';
import type { getSelectedWidgetToolbarItem } from '@/ui-desks/desk/selection-toolbar/selection';
import type { StackViewMode } from '@/ui-desks/stacks/utils';
import type { AnnotationPayload } from '@/ui-desks/widgets/site-preview/annotation-inspector';
import type { DeskWidget, WidgetPastePayload } from '@/ui-desks/widgets/types';
import type { ReactNode } from 'react';
import type { Editor, TLShapeId } from 'tldraw';

export type SelectedWidgetToolbarItem = NonNullable<
	ReturnType< typeof getSelectedWidgetToolbarItem >
>;

export type RegisterDeskEditor = ( editor: Editor | null ) => void;

export interface DeskAnnotationSubmission {
	annotations: Annotation[];
	previewWidget?: DeskWidget;
}

export interface DeskContextValue {
	siteId?: string;
	isLoading: boolean;
	isReadOnly: boolean;
	statusMessage?: string;
	canAddWidgets: boolean;
	selectedWidgetToolbarItem: SelectedWidgetToolbarItem | null;
	selectedConnectorToolbarItem: SelectedDeskConnectorToolbarItem | null;
	selectedWidgetConnectionTargets: DeskWidgetConnectionTarget[];
	isConnectingWidget: boolean;
	annotatingPreviewShapeId: TLShapeId | null;
	annotationCount: number;
	selectedAnnotationNoteShapeId: TLShapeId | null;
	pendingAnnotation: { previewShapeId: TLShapeId; payload: AnnotationPayload } | null;
	pressedStackId: string | null;
	registerEditor: RegisterDeskEditor;
	pressStack: ( stackId: string ) => void;
	addWidget: ( type: string, options?: AddDeskWidgetOptions ) => boolean;
	addWidgetAtScreenPoint: (
		type: string,
		point: { x: number; y: number },
		options?: Omit< AddDeskWidgetOptions, 'center' >
	) => boolean;
	addPastedContent: (
		payload: WidgetPastePayload,
		options?: AddDeskWidgetOptions
	) => Promise< boolean >;
	startDrawing: () => boolean;
	finishDrawing: () => Promise< boolean >;
	updateSelectedWidgetProps: ( widgetProps: Record< string, unknown > ) => boolean;
	canEditSelectedWidget: boolean;
	editSelectedWidget: () => boolean;
	fitSelectedWidgetToContent: () => Promise< boolean >;
	stackSelectedWidgets: () => boolean;
	unstackSelectedWidgets: () => boolean;
	setSelectedStackView: ( viewMode: StackViewMode ) => boolean;
	removeSelectedWidget: () => boolean;
	removeSelectedConnector: () => boolean;
	startConnectingWidget: ( shapeId: TLShapeId ) => boolean;
	focusConnectedWidget: ( shapeId: TLShapeId ) => boolean;
	startAnnotatingPreview: ( shapeId: TLShapeId ) => boolean;
	stopAnnotatingPreview: () => boolean;
	requestAnnotation: ( previewShapeId: TLShapeId, payload: AnnotationPayload ) => void;
	confirmPendingAnnotation: ( comment: string ) => boolean;
	cancelPendingAnnotation: () => void;
	removeSelectedAnnotation: () => boolean;
	collectAnnotationSubmission: () => DeskAnnotationSubmission | null;
}

export interface AddDeskWidgetOptions {
	id?: string;
	center?: {
		x: number;
		y: number;
	};
	shapeProps?: Record< string, unknown >;
	widgetProps?: Record< string, unknown >;
	shouldStartEditing?: boolean;
}

export interface DeskProviderProps {
	siteId?: string;
	children: ReactNode;
	deskConfig?: DeskConfig;
	deskConfigKey?: string;
	initialViewportMode?: 'site-map';
	isLoading?: boolean;
	isReadOnly?: boolean;
	statusMessage?: string;
}

const defaultDeskContext: DeskContextValue = {
	siteId: undefined,
	isLoading: true,
	isReadOnly: false,
	statusMessage: undefined,
	canAddWidgets: false,
	selectedWidgetToolbarItem: null,
	selectedConnectorToolbarItem: null,
	selectedWidgetConnectionTargets: [],
	isConnectingWidget: false,
	annotatingPreviewShapeId: null,
	annotationCount: 0,
	selectedAnnotationNoteShapeId: null,
	pendingAnnotation: null,
	pressedStackId: null,
	registerEditor: noopRegisterEditor,
	pressStack: noopPressStack,
	addWidget: () => false,
	addWidgetAtScreenPoint: () => false,
	addPastedContent: () => Promise.resolve( false ),
	startDrawing: () => false,
	finishDrawing: async () => false,
	updateSelectedWidgetProps: () => false,
	canEditSelectedWidget: false,
	editSelectedWidget: () => false,
	fitSelectedWidgetToContent: () => Promise.resolve( false ),
	stackSelectedWidgets: () => false,
	unstackSelectedWidgets: () => false,
	setSelectedStackView: () => false,
	removeSelectedWidget: () => false,
	removeSelectedConnector: () => false,
	startConnectingWidget: () => false,
	focusConnectedWidget: () => false,
	startAnnotatingPreview: () => false,
	stopAnnotatingPreview: () => false,
	requestAnnotation: noopRequestAnnotation,
	confirmPendingAnnotation: () => false,
	cancelPendingAnnotation: noopCancelPendingAnnotation,
	removeSelectedAnnotation: () => false,
	collectAnnotationSubmission: () => null,
};

export const DeskContext = createContext< DeskContextValue >( defaultDeskContext );

export function useDesk() {
	return useContext( DeskContext );
}

export function useRegisterDeskEditor() {
	return useDesk().registerEditor;
}

function noopRegisterEditor() {}
function noopPressStack() {}
function noopRequestAnnotation() {}
function noopCancelPendingAnnotation() {}
