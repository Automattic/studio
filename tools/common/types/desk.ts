export const DESK_CONFIG_VERSION = 1;
export const DESK_SETTINGS_VERSION = 1;

export type StudioUiMode = 'default' | 'studio2';
export type LegacyStudioUiMode = 'desks' | 'agentic';
export type StoredStudioUiMode = StudioUiMode | LegacyStudioUiMode;

export interface DeskToolbarLayout {
	left: string[];
	right: string[];
}

export interface DeskSettings {
	version: typeof DESK_SETTINGS_VERSION;
	updatedAt: string;
	showSiteName: boolean;
	toolbarLayout: DeskToolbarLayout;
}

export interface DeskWidgetBase<
	TType extends string = string,
	TShapeProps extends Record< string, unknown > = Record< string, unknown >,
	TWidgetProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	type: TType;
	x: number;
	y: number;
	rotation?: number;
	zIndex: string;
	shapeProps: TShapeProps;
	widgetProps: TWidgetProps;
}

export interface DeskViewport {
	x: number;
	y: number;
	z: number;
}

export type DeskStackViewMode = 'stack' | 'tiles' | 'circle';

export interface DeskStack {
	id: string;
	x: number;
	y: number;
	zIndex: string;
	memberIds: string[];
	viewMode?: DeskStackViewMode;
}

export interface DeskConnectorEndpoint {
	widgetId: string;
	normalizedAnchor: {
		x: number;
		y: number;
	};
}

export interface DeskConnector {
	id: string;
	from: DeskConnectorEndpoint;
	to: DeskConnectorEndpoint;
	bend?: number;
	appearance?: {
		dash?: 'solid' | 'dashed';
		arrowheadStart?: 'none' | 'dot';
		arrowheadEnd?: 'none' | 'arrow';
	};
}

export interface DeskConfig< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	version: typeof DESK_CONFIG_VERSION;
	updatedAt: string;
	viewport?: DeskViewport;
	widgets: TWidget[];
	stacks?: DeskStack[];
	connectors?: DeskConnector[];
}

export interface DesksConfig {
	defaultUiMode?: StoredStudioUiMode;
	settings?: DeskSettings;
	user?: DeskConfig;
	sites?: Record< string, DeskConfig >;
}
