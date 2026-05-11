import type { ControlConfig } from '@/ui-desks/controls/types';
import type { BlogWidget } from '@/ui-desks/widgets/blog/types';
import type { LoadingWidget } from '@/ui-desks/widgets/loading/types';
import type { MediaWidget } from '@/ui-desks/widgets/media/types';
import type { NoteWidget } from '@/ui-desks/widgets/note/types';
import type { PageWidget } from '@/ui-desks/widgets/page/types';
import type { PostWidget } from '@/ui-desks/widgets/post/types';
import type { PostCollectionWidget } from '@/ui-desks/widgets/post-collection/types';
import type { SitePreviewWidget } from '@/ui-desks/widgets/site-preview/types';
import type { DeskStack, DeskWidgetBase } from '@studio/common/types/desk';
import type { createRegistry } from '@wordpress/data';
import type { ComponentProps, ComponentType, ReactElement } from 'react';

export interface WidgetIndicator {
	cornerRadius?: number;
	stroke?: string;
}

export type WidgetResolutionState = 'loading';

export interface DeskWidgetComponentProps<
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	widgetProps: TWidgetProps;
	isEditing: boolean;
	isHovered: boolean;
	isSelected: boolean;
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
}

export interface WidgetFileHandlerLoading {
	label?: string;
	shapeProps?: Record< string, unknown >;
}

export interface WidgetFileHandlerWidget< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	id?: string;
	shapeProps?: Partial< TWidget[ 'shapeProps' ] >;
	widgetProps?: Partial< TWidget[ 'widgetProps' ] >;
	shouldStartEditing?: boolean;
}

export type WidgetFileHandlerResult< TWidget extends DeskWidgetBase = DeskWidgetBase > =
	| WidgetFileHandlerWidget< TWidget >
	| Array< WidgetFileHandlerWidget< TWidget > >;

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

export interface WidgetDefinition< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	type: TWidget[ 'type' ];
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
	getLoadingShapeProps?: ( widget: TWidget ) => TWidget[ 'shapeProps' ];
	getIndicator?: ( widgetProps: TWidget[ 'widgetProps' ] ) => WidgetIndicator;
	resolver?: WidgetResolver< TWidget >;
	fileHandlers?: Array< WidgetFileHandler< TWidget > >;
}

export type DeskWidget =
	| BlogWidget
	| LoadingWidget
	| NoteWidget
	| MediaWidget
	| PostWidget
	| PageWidget
	| PostCollectionWidget
	| SitePreviewWidget;
export type DeskWidgetDefinition =
	| WidgetDefinition< BlogWidget >
	| WidgetDefinition< LoadingWidget >
	| WidgetDefinition< NoteWidget >
	| WidgetDefinition< MediaWidget >
	| WidgetDefinition< PostWidget >
	| WidgetDefinition< PageWidget >
	| WidgetDefinition< PostCollectionWidget >
	| WidgetDefinition< SitePreviewWidget >;
