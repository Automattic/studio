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
import { useStackAnimation } from '@/ui-desks/stacks/context';
import { getStackId, getStackOrder, isStackExpanded } from '@/ui-desks/stacks/utils';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
	type RectangleWidgetShapeProps,
} from './types';
import type { DeskWidgetComponentProps, WidgetIndicator } from '@/ui-desks/widgets/types';
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
			info as TLResizeInfo< typeof shape & { props: RectangleWidgetShapeProps } >
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
		if ( getStackId( shape ) && ! isStackExpanded( shape ) ) {
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
			/>
		);
	}
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
	const stackInteraction = useStackInteraction( shape );
	const WidgetComponent = definition.Component as unknown as ComponentType<
		DeskWidgetComponentProps< JsonObject >
	>;

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
		<div style={ stackInteraction.style } onPointerDown={ stackInteraction.onPointerDown }>
			<WidgetComponent
				id={ getWidgetIdFromShapeId( shape.id ) }
				widgetProps={ shape.props.widgetProps }
				isEditing={ isEditing }
				onWidgetPropsChange={ handleWidgetPropsChange }
				onEditComplete={ () => editor.complete() }
			/>
		</div>
	);
}

function useStackInteraction( shape: RectangleWidgetShape ) {
	const editor = useEditor();
	const { pressedStackId, pressStack } = useStackAnimation();
	const stackId = getStackId( shape );
	const isExpanded = isStackExpanded( shape );
	const hoveredStackId = useValue(
		'desk-stack-hovered-stack-id',
		() => {
			const hoveredShape = editor.getHoveredShape();
			const hoveredShapeStackId = getStackId( hoveredShape );
			return hoveredShapeStackId && ! isStackExpanded( hoveredShape ) ? hoveredShapeStackId : null;
		},
		[ editor ]
	);
	const isHovered = Boolean( stackId ) && ! isExpanded && hoveredStackId === stackId;
	const isPressed = Boolean( stackId ) && ! isExpanded && pressedStackId === stackId;
	const order = getStackOrder( shape );
	const members = stackId
		? editor.getCurrentPageShapes().filter( ( member ) => getStackId( member ) === stackId )
		: [];
	const center = ( members.length - 1 ) / 2;
	const step = order - center;
	const hoverTranslate = isHovered ? step * 7 : 0;
	const hoverRotate = isHovered ? step * 2.5 : 0;
	const pressScale = isPressed ? 0.985 : 1;

	return {
		style: {
			width: '100%',
			height: '100%',
			transform: `translate(${ hoverTranslate }px, ${ hoverTranslate }px) rotate(${ hoverRotate }deg) scale(${ pressScale })`,
			transformOrigin: 'center',
			transition: 'transform 220ms ease',
		},
		onPointerDown: () => {
			if ( stackId && ! isExpanded ) {
				pressStack( stackId );
			}
		},
	};
}

function getWidgetIdFromShapeId( shapeId: string ) {
	return shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
}
