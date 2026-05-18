import type { ControlConfig } from '@/ui-desks/controls/types';
import type { BlogWidget } from '@/ui-desks/widgets/blog/types';
import type { BookmarkWidget } from '@/ui-desks/widgets/bookmark/types';
import type { ColorWidget } from '@/ui-desks/widgets/color/types';
import type { DrawingWidget } from '@/ui-desks/widgets/drawing/types';
import type { EmbedWidget } from '@/ui-desks/widgets/embed/types';
import type { LoadingWidget } from '@/ui-desks/widgets/loading/types';
import type { MediaWidget } from '@/ui-desks/widgets/media/types';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PageWidget } from '@/ui-desks/widgets/page/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { PostCollectionWidget } from '@/ui-desks/widgets/post-collection/types';
import type { ScratchpadWidget } from '@/ui-desks/widgets/scratchpad/types';
import type { SiteCardWidget } from '@/ui-desks/widgets/site-card/types';
import type { SitePreviewWidget } from '@/ui-desks/widgets/site-preview/types';
import type { ThemeWidget } from '@/ui-desks/widgets/theme/types';
import type { ThemePatternWidget } from '@/ui-desks/widgets/theme-pattern/types';
import type { ThemePatternBrowserWidget } from '@/ui-desks/widgets/theme-pattern-browser/types';
import type { ThemeStylesWidget } from '@/ui-desks/widgets/theme-styles/types';
import type { ThemeTemplateWidget } from '@/ui-desks/widgets/theme-template/types';
import type { ThemeTemplateBrowserWidget } from '@/ui-desks/widgets/theme-template-browser/types';
import type { DeskStack, DeskWidgetBase } from '@studio/common/types/desk';
import type { createRegistry } from '@wordpress/data';
import type { ComponentProps, ComponentType, ReactElement } from 'react';
import type { Editor, JsonObject, TLShapeId } from 'tldraw';

export interface WidgetIndicator {
	cornerRadius?: number;
	stroke?: string;
}

export type WidgetResolutionState = 'loading';

export type WidgetDropFeedbackPhase = 'hover' | 'menu';

export interface WidgetDropFeedbackTarget {
	kind: string;
	props: JsonObject;
	phase: WidgetDropFeedbackPhase;
}

export interface ActiveWidgetDropFeedback {
	targetShapeId: TLShapeId;
	feedback: WidgetDropFeedbackTarget;
}

export interface WidgetDropFeedback {
	sourceOpacity?: number;
	target?: Omit< WidgetDropFeedbackTarget, 'phase' >;
}

export interface DeskWidgetComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	shapeId?: TLShapeId;
	widgetProps: TWidgetProps;
	isEditing: boolean;
	isHovered: boolean;
	isSelected: boolean;
	dropFeedback?: WidgetDropFeedbackTarget | null;
	onWidgetPropsChange: ( widgetProps: TWidgetProps ) => void;
	onEditComplete: () => void;
}

export type DeskWidgetThumbnailComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> = DeskWidgetComponentProps< TWidgetProps >;

export interface DeskWidgetLoadingComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	widgetProps: TWidgetProps;
}

export type WidgetIcon = ReactElement< ComponentProps< 'svg' > >;

export interface WidgetLabels {
	add: () => string;
	edit?: () => string;
	fitContent?: () => string;
}

export type WidgetResolverRegistry = ReturnType< typeof createRegistry >;

export interface WidgetResolverContext {
	registry: WidgetResolverRegistry;
}

export interface WidgetFileAccept {
	mimeTypes?: string[];
	extensions?: string[];
}

export interface WidgetFileHandlerContext {
	siteId?: string;
	getFilePath?: ( file: File ) => Promise< string >;
}

export interface WidgetHandlerLoading {
	label?: string;
	shapeProps?: Record< string, unknown >;
}

export interface WidgetHandlerWidget< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	id?: string;
	shapeProps?: Partial< TWidget[ 'shapeProps' ] >;
	widgetProps?: Partial< TWidget[ 'widgetProps' ] >;
	shouldStartEditing?: boolean;
}

export type WidgetHandlerResult< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	| WidgetHandlerWidget< TWidget >
	| Array< WidgetHandlerWidget< TWidget > >;

export type WidgetFileHandlerLoading = WidgetHandlerLoading;
export type WidgetFileHandlerWidget< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	WidgetHandlerWidget< TWidget >;
export type WidgetFileHandlerResult< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	WidgetHandlerResult< TWidget >;

export interface WidgetFileHandler< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	id: string;
	accept: WidgetFileAccept;
	loading?: WidgetFileHandlerLoading;
	requiresRunningSite?: boolean;
	handle: (
		file: File,
		context: WidgetFileHandlerContext
	) => Promise< WidgetFileHandlerResult< TWidget > | null >;
}

export type WidgetPasteKind = 'url';

export type WidgetPastePayload = {
	kind: 'url';
	text: string;
	url: string;
};

export interface WidgetPasteAccept {
	kinds?: WidgetPasteKind[];
	protocols?: string[];
}

export interface WidgetPasteHandlerContext {
	siteId?: string;
}

export type WidgetPasteHandlerLoading = WidgetHandlerLoading;
export type WidgetPasteHandlerWidget< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	WidgetHandlerWidget< TWidget >;
export type WidgetPasteHandlerResult< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	WidgetHandlerResult< TWidget >;

export interface WidgetPasteHandler< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	id: string;
	accept: WidgetPasteAccept;
	loading?: WidgetPasteHandlerLoading;
	requiresRunningSite?: boolean;
	canHandle?: ( payload: WidgetPastePayload, context: WidgetPasteHandlerContext ) => boolean;
	handle: (
		payload: WidgetPastePayload,
		context: WidgetPasteHandlerContext
	) => Promise< WidgetPasteHandlerResult< TWidget > | null >;
}

export interface WidgetConnectorDropHandler {
	id: string;
	type: 'connector';
	sourceTypes?: string[];
	canHandle?: ( sourceWidget: DeskWidgetBase, targetWidget: DeskWidgetBase ) => boolean;
}

export type WidgetCoreDataSaveEntityRecord = (
	kind: string,
	name: string,
	record: Record< string, unknown >,
	options?: {
		throwOnError?: boolean;
	}
) => Promise< unknown >;

export interface WidgetCustomDropActionIntent {
	sourceShapeId: TLShapeId;
	targetShapeId: TLShapeId;
	sourceWidget: DeskWidget;
	targetWidget: DeskWidget;
	screenPoint: {
		x: number;
		y: number;
	};
}

export interface WidgetDropFeedbackIntent extends WidgetCustomDropActionIntent {
	phase: WidgetDropFeedbackPhase;
}

export interface WidgetCustomDropActionContext {
	editor: Editor;
	registry: WidgetResolverRegistry;
	runAction: ( action: () => void | Promise< unknown > ) => void;
	saveEntityRecord: WidgetCoreDataSaveEntityRecord;
	startChatWithPrompt: ( request: {
		prompt: string;
		displayMessage?: string;
	} ) => Promise< string >;
}

export interface WidgetCustomDropAction {
	label: string;
	onClick: () => void;
}

export interface WidgetCustomDropHandler {
	id: string;
	type: 'custom';
	sourceTypes?: string[];
	canHandle?: ( sourceWidget: DeskWidgetBase, targetWidget: DeskWidgetBase ) => boolean;
	getFeedback?: ( intent: WidgetDropFeedbackIntent ) => WidgetDropFeedback | null;
	getActions?: (
		intent: WidgetCustomDropActionIntent,
		context: WidgetCustomDropActionContext
	) => WidgetCustomDropAction[];
}

export type WidgetDropHandler = WidgetConnectorDropHandler | WidgetCustomDropHandler;

export type ResolvedDeskWidgetOrigin =
	| { kind: 'authored' }
	| {
			kind: 'derived';
			sourceWidgetId: string;
			key: string;
	  };

export interface ResolvedDeskWidget< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	widget: TWidget;
	origin: ResolvedDeskWidgetOrigin;
}

export interface ResolvedDeskStack {
	stack: DeskStack;
	origin: Extract< ResolvedDeskWidgetOrigin, { kind: 'derived' } >;
	followSourceWidgetId?: string;
}

export interface WidgetResolution< TIdentity = unknown > {
	widgets: ResolvedDeskWidget[];
	stacks?: ResolvedDeskStack[];
	identity: TIdentity;
}

export interface WidgetResolver<
	TWidget extends DeskWidgetBase = DeskWidgetBase,
	TIdentity = unknown,
> {
	/**
	 * Derived widgets should treat the source widget's x/y as the top-left origin of
	 * the primary resolved shape. Persistence writes that same primary origin back
	 * to the source widget, so center-based resolver layouts will drift on reload.
	 */
	resolve: (
		widget: TWidget,
		context: WidgetResolverContext
	) => Promise< WidgetResolution< TIdentity > >;
	invalidate: (
		widget: TWidget,
		previousIdentity: TIdentity,
		context: WidgetResolverContext
	) => boolean;
}

export interface WidgetFitContentContext< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	widgetProps: TWidget[ 'widgetProps' ];
	shapeProps: TWidget[ 'shapeProps' ];
}

export type WidgetFitContentResult< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	| TWidget[ 'shapeProps' ]
	| null;

export type WidgetEditAction = { kind: 'canvas-editing' } | { kind: 'site-url'; path: string };

export interface WidgetEditActionContext< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	widget: TWidget;
	hasSiteId: boolean;
	hasRunningSite: boolean;
}

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
	name: () => string;
	Component: ComponentType< DeskWidgetComponentProps< TWidget[ 'widgetProps' ] > >;
	thumbnail?: ComponentType< DeskWidgetThumbnailComponentProps< TWidget[ 'widgetProps' ] > >;
	loading?: ComponentType< DeskWidgetLoadingComponentProps< TWidget[ 'widgetProps' ] > >;
	controls?: Array< ControlConfig< TWidget[ 'widgetProps' ] > >;
	isWidgetProps: ( props: unknown ) => props is TWidget[ 'widgetProps' ];
	labels: WidgetLabels;
	icon?: WidgetIcon;
	isCreatable?: boolean;
	requiresRunningSite?: boolean;
	shouldStartEditingOnCreate?: boolean;
	getInitialWidget: () => Pick< TWidget, 'shapeProps' | 'widgetProps' >;
	getSummary?: ( widgetProps: TWidget[ 'widgetProps' ] ) => string;
	getLoadingShapeProps?: ( widget: TWidget ) => TWidget[ 'shapeProps' ];
	getIndicator?: ( widgetProps: TWidget[ 'widgetProps' ] ) => WidgetIndicator;
	getFittedShapeProps?: (
		context: WidgetFitContentContext< TWidget >
	) => WidgetFitContentResult< TWidget > | Promise< WidgetFitContentResult< TWidget > >;
	getEditAction?: ( context: WidgetEditActionContext< TWidget > ) => WidgetEditAction | null;
	focusModeControls?: Array< ControlConfig< TWidget[ 'widgetProps' ] > >;
	focusModeControlsLabel?: () => string;
	preserveSourceWidgetPosition?: boolean;
	resolver?: WidgetResolver< TWidget >;
	fileHandlers?: Array< WidgetFileHandler< TWidget > >;
	pasteHandlers?: Array< WidgetPasteHandler< TWidget > >;
	dropHandlers?: WidgetDropHandler[];
}

export type DeskWidget =
	| ScratchpadWidget
	| BookmarkWidget
	| BlogWidget
	| ColorWidget
	| DrawingWidget
	| EmbedWidget
	| LoadingWidget
	| NoteWidget
	| MediaWidget
	| PostWidget
	| PageWidget
	| PostCollectionWidget
	| SiteCardWidget
	| SitePreviewWidget
	| ThemeWidget
	| ThemePatternBrowserWidget
	| ThemeTemplateBrowserWidget
	| ThemePatternWidget
	| ThemeStylesWidget
	| ThemeTemplateWidget;
export type DeskWidgetDefinition =
	| WidgetDefinition< ScratchpadWidget >
	| WidgetDefinition< BookmarkWidget >
	| WidgetDefinition< BlogWidget >
	| WidgetDefinition< ColorWidget >
	| WidgetDefinition< DrawingWidget >
	| WidgetDefinition< EmbedWidget >
	| WidgetDefinition< LoadingWidget >
	| WidgetDefinition< NoteWidget >
	| WidgetDefinition< MediaWidget >
	| WidgetDefinition< PostWidget >
	| WidgetDefinition< PageWidget >
	| WidgetDefinition< PostCollectionWidget >
	| WidgetDefinition< SiteCardWidget >
	| WidgetDefinition< SitePreviewWidget >
	| WidgetDefinition< ThemeWidget >
	| WidgetDefinition< ThemePatternBrowserWidget >
	| WidgetDefinition< ThemeTemplateBrowserWidget >
	| WidgetDefinition< ThemePatternWidget >
	| WidgetDefinition< ThemeStylesWidget >
	| WidgetDefinition< ThemeTemplateWidget >;
