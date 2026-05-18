import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	useEditor,
	useIsEditing,
	useValue,
	type JsonObject,
	type RecordProps,
	type TLResizeInfo,
} from 'tldraw';
import { getDeskCanvasRecordResolutionState } from '@/ui-desks/desk/tldraw-adapter';
import { useStackShapeInteraction } from '@/ui-desks/stacks/use-stack-shape-interaction';
import { getStackId, getStackViewMode, isStackExpanded } from '@/ui-desks/stacks/utils';
import { useWidgetDropFeedback } from '@/ui-desks/widget-actions/drop-feedback-context';
import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
	type RectangleWidgetShapeProps,
} from './types';
import type {
	DeskWidgetComponentProps,
	DeskWidgetLoadingComponentProps,
	WidgetIndicator,
} from '@/ui-desks/widgets/types';
import type { ComponentType } from 'react';

type RegisteredWidgetDefinition = NonNullable< ReturnType< typeof getWidgetDefinition > >;

export class RectangleWidgetShapeUtil extends ShapeUtil< RectangleWidgetShape > {
	static override type = RECTANGLE_WIDGET_SHAPE_TYPE;

	static override props: RecordProps< RectangleWidgetShape > = {
		widgetType: T.string,
		shapeProps: T.object< RectangleWidgetShapeProps >( {
			w: T.number,
			h: T.number,
		} ),
		widgetProps: T.jsonValue as T.Validator< JsonObject >,
	};

	override getDefaultProps(): RectangleWidgetShape[ 'props' ] {
		return {
			widgetType: '',
			shapeProps: {
				w: 260,
				h: 220,
			},
			widgetProps: {},
		};
	}

	override canResize(): boolean {
		return true;
	}

	override canEdit(): boolean {
		return true;
	}

	override getGeometry( shape: RectangleWidgetShape ) {
		return new Rectangle2d( {
			width: shape.props.shapeProps.w,
			height: shape.props.shapeProps.h,
			isFilled: true,
		} );
	}

	override onResize( shape: RectangleWidgetShape, info: TLResizeInfo< RectangleWidgetShape > ) {
		const resizedShape = resizeBox(
			{
				...shape,
				props: shape.props.shapeProps,
			},
			info as TLResizeInfo< typeof shape & { props: RectangleWidgetShapeProps } >,
			getWidgetDefinition( shape.props.widgetType )?.resizeConstraints
		);

		return {
			x: resizedShape.x,
			y: resizedShape.y,
			props: {
				shapeProps: resizedShape.props,
			},
		};
	}

	override component( shape: RectangleWidgetShape ) {
		const definition = getWidgetDefinition( shape.props.widgetType );
		if ( ! definition || ! definition.isWidgetProps( shape.props.widgetProps ) ) {
			return null;
		}

		return (
			<HTMLContainer
				style={ {
					width: shape.props.shapeProps.w,
					height: shape.props.shapeProps.h,
					pointerEvents: 'all',
				} }
			>
				<RectangleWidgetComponent shape={ shape } definition={ definition } />
			</HTMLContainer>
		);
	}

	override indicator( shape: RectangleWidgetShape ) {
		return <RectangleWidgetIndicator shape={ shape } />;
	}
}

function RectangleWidgetIndicator( { shape }: { shape: RectangleWidgetShape } ) {
	const editor = useEditor();
	const isSelected = useValue(
		`rectangle-widget-indicator-selected:${ shape.id }`,
		() => editor.getSelectedShapeIds().includes( shape.id ),
		[ editor, shape.id ]
	);

	if (
		getStackId( shape ) &&
		! isStackExpanded( shape ) &&
		getStackViewMode( shape ) !== 'tiles'
	) {
		return null;
	}

	if ( shape.props.widgetType === DRAWING_WIDGET_TYPE ) {
		return null;
	}

	const definition = getWidgetDefinition( shape.props.widgetType );
	const indicator = getWidgetIndicator( definition, shape.props.widgetProps );

	return (
		<rect
			width={ shape.props.shapeProps.w }
			height={ shape.props.shapeProps.h }
			rx={ indicator?.cornerRadius ?? 14 }
			ry={ indicator?.cornerRadius ?? 14 }
			fill="none"
			stroke={ indicator?.stroke }
			style={ { strokeWidth: indicatorStrokeWidth( isSelected ) } }
		/>
	);
}

const INDICATOR_STROKE_WIDTH_HOVER = 1.5;
const INDICATOR_STROKE_WIDTH_SELECTED = 3;

function indicatorStrokeWidth( isSelected: boolean ): string {
	const width = isSelected ? INDICATOR_STROKE_WIDTH_SELECTED : INDICATOR_STROKE_WIDTH_HOVER;
	return `calc(${ width }px * var(--tl-scale))`;
}

function getWidgetIndicator(
	definition: RegisteredWidgetDefinition | undefined,
	widgetProps: JsonObject
) {
	if ( ! definition || ! definition.isWidgetProps( widgetProps ) || ! definition.getIndicator ) {
		return undefined;
	}

	return ( definition.getIndicator as ( props: JsonObject ) => WidgetIndicator )( widgetProps );
}

function RectangleWidgetComponent( {
	shape,
	definition,
}: {
	shape: RectangleWidgetShape;
	definition: RegisteredWidgetDefinition;
} ) {
	const editor = useEditor();
	const isEditing = useIsEditing( shape.id );
	const stackInteraction = useStackShapeInteraction( shape );
	const isHovered = useValue(
		`rectangle-widget-is-hovered:${ shape.id }`,
		() => editor.getHoveredShapeId() === shape.id,
		[ editor, shape.id ]
	);
	const isSelected = useValue(
		`rectangle-widget-is-selected:${ shape.id }`,
		() => editor.getSelectedShapeIds().includes( shape.id ),
		[ editor, shape.id ]
	);
	const WidgetComponent = definition.Component as unknown as ComponentType<
		DeskWidgetComponentProps< JsonObject >
	>;
	const LoadingComponent = definition.loading as
		| ComponentType< DeskWidgetLoadingComponentProps< JsonObject > >
		| undefined;
	const isLoading = getDeskCanvasRecordResolutionState( shape ) === 'loading';
	const widgetId = getWidgetIdFromShapeId( shape.id );
	const dropFeedback = useWidgetDropFeedback( shape.id );

	const handleWidgetPropsChange = ( widgetProps: JsonObject ) => {
		editor.updateShape< RectangleWidgetShape >( {
			id: shape.id,
			type: shape.type,
			props: {
				widgetProps,
			},
		} );
	};

	return (
		<div
			style={ stackInteraction.style }
			onPointerDown={ stackInteraction.onPointerDown }
			onPointerUp={ stackInteraction.onPointerUp }
		>
			{ isLoading && LoadingComponent ? (
				<LoadingComponent id={ widgetId } widgetProps={ shape.props.widgetProps } />
			) : (
				<WidgetComponent
					id={ widgetId }
					shapeId={ shape.id }
					widgetProps={ shape.props.widgetProps }
					isEditing={ isEditing }
					isHovered={ isHovered }
					isSelected={ isSelected }
					dropFeedback={ dropFeedback }
					onWidgetPropsChange={ handleWidgetPropsChange }
					onEditComplete={ () => editor.complete() }
				/>
			) }
		</div>
	);
}

function getWidgetIdFromShapeId( shapeId: string ) {
	return shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
}
