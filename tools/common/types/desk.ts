export const DESK_CONFIG_VERSION = 1;

export interface DeskWidgetBase<
	TType extends string = string,
	TProps extends Record< string, unknown > = Record< string, unknown >,
> {
	id: string;
	type: TType;
	x: number;
	y: number;
	rotation?: number;
	zIndex: string;
	props: TProps;
}

export interface DeskViewport {
	x: number;
	y: number;
	z: number;
}

export interface DeskConfig< TWidget extends DeskWidgetBase = DeskWidgetBase > {
	version: typeof DESK_CONFIG_VERSION;
	updatedAt: string;
	viewport?: DeskViewport;
	widgets: TWidget[];
}

export interface DesksConfig {
	user?: DeskConfig;
	sites?: Record< string, DeskConfig >;
}
