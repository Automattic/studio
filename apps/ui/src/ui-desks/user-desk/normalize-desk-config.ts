import { DESK_CONFIG_VERSION, type DeskConfig, type DeskViewport } from '@/ui-desks/desk/types';
import { RECTANGLE_WIDGET_SHAPE_TYPE } from '@/ui-desks/shapes/rectangle-widget/types';
import {
	NOTE_WIDGET_TYPE,
	isNoteWidgetProps,
	type NoteWidget,
} from '@/ui-desks/widgets/note/types';
import type { DeskWidget } from '@/ui-desks/widgets/types';

export function normalizeDeskConfig( value: unknown ): DeskConfig | undefined {
	if (
		! isRecord( value ) ||
		value.version !== DESK_CONFIG_VERSION ||
		! Array.isArray( value.widgets )
	) {
		return undefined;
	}

	let changed = false;
	const widgets = value.widgets.flatMap( ( widget ) => {
		const normalizedWidget = normalizeDeskWidget( widget );
		if ( ! normalizedWidget ) {
			changed = true;
			return [];
		}
		if ( normalizedWidget !== widget ) {
			changed = true;
		}
		return [ normalizedWidget ];
	} );

	const viewport = isDeskViewport( value.viewport ) ? value.viewport : undefined;
	if ( value.viewport !== undefined && viewport === undefined ) {
		changed = true;
	}

	if ( ! changed && typeof value.updatedAt === 'string' ) {
		return value as unknown as DeskConfig;
	}

	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
		viewport,
		widgets,
	};
}

function normalizeDeskWidget( value: unknown ): DeskWidget | undefined {
	if ( ! isRecord( value ) ) {
		return undefined;
	}

	if ( isPreviousNoteWidgetWithShapeType( value ) ) {
		return createNoteWidgetFromNormalizedParts( value );
	}

	if ( isCurrentNoteWidget( value ) ) {
		return value;
	}

	if ( isLegacyNoteWidget( value ) ) {
		return createNoteWidgetFromNormalizedParts( {
			id: value.id,
			x: value.x,
			y: value.y,
			rotation: value.rotation,
			zIndex: value.zIndex,
			shapeProps: {
				w: value.props.w,
				h: value.props.h,
			},
			widgetProps: {
				text: value.props.text,
				color: value.props.color,
			},
		} );
	}

	return undefined;
}

function isCurrentNoteWidget( value: unknown ): value is NoteWidget {
	return (
		hasNoteWidgetFields( value ) &&
		value.shapeType === undefined &&
		isNoteWidgetProps( value.widgetProps )
	);
}

function isPreviousNoteWidgetWithShapeType( value: unknown ): value is Omit<
	NoteWidget,
	'type'
> & {
	type: typeof NOTE_WIDGET_TYPE;
	shapeType: typeof RECTANGLE_WIDGET_SHAPE_TYPE;
} {
	return hasNoteWidgetFields( value ) && value.shapeType === RECTANGLE_WIDGET_SHAPE_TYPE;
}

function hasNoteWidgetFields( value: unknown ): value is Omit< NoteWidget, 'type' > & {
	type: typeof NOTE_WIDGET_TYPE;
	shapeType?: unknown;
} {
	return (
		isRecord( value ) &&
		value.type === NOTE_WIDGET_TYPE &&
		typeof value.id === 'string' &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		( value.rotation === undefined || typeof value.rotation === 'number' ) &&
		typeof value.zIndex === 'string' &&
		isRecord( value.shapeProps ) &&
		typeof value.shapeProps.w === 'number' &&
		typeof value.shapeProps.h === 'number' &&
		isNoteWidgetProps( value.widgetProps )
	);
}

function createNoteWidgetFromNormalizedParts( value: Omit< NoteWidget, 'type' > ): NoteWidget {
	return {
		id: value.id,
		type: NOTE_WIDGET_TYPE,
		x: value.x,
		y: value.y,
		rotation: value.rotation,
		zIndex: value.zIndex,
		shapeProps: value.shapeProps,
		widgetProps: value.widgetProps,
	};
}

function isLegacyNoteWidget( value: Record< string, unknown > ): value is Record<
	string,
	unknown
> & {
	id: string;
	x: number;
	y: number;
	rotation?: number;
	zIndex: string;
	props: { w: number; h: number; text: string; color: NoteWidget[ 'widgetProps' ][ 'color' ] };
} {
	return (
		value.type === NOTE_WIDGET_TYPE &&
		typeof value.id === 'string' &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		( value.rotation === undefined || typeof value.rotation === 'number' ) &&
		typeof value.zIndex === 'string' &&
		isRecord( value.props ) &&
		typeof value.props.w === 'number' &&
		typeof value.props.h === 'number' &&
		isNoteWidgetProps( {
			text: value.props.text,
			color: value.props.color,
		} )
	);
}

function isDeskViewport( value: unknown ): value is DeskViewport {
	return (
		isRecord( value ) &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		typeof value.z === 'number' &&
		value.z > 0
	);
}

function isRecord( value: unknown ): value is Record< string, unknown > {
	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );
}
