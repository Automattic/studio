import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	useEditor,
	useIsEditing,
	type JsonObject,
	type RecordProps,
	type TLResizeInfo,
} from 'tldraw';
import { getWidgetDefinition } from '@/ui-desks/widgets/registry';
import {
	RECTANGLE_WIDGET_SHAPE_TYPE,
	type RectangleWidgetShape,
	type RectangleWidgetShapeProps,
} from './types';
import type { DeskWidgetComponentProps } from '@/ui-desks/widgets/types';
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
		const definition = getWidgetDefinition( shape.props.widgetType );
		const indicator =
			definition && definition.isWidgetProps( shape.props.widgetProps )
				? definition.getIndicator?.( shape.props.widgetProps )
				: undefined;

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

function RectangleWidgetComponent( {
	shape,
	definition,
}: {
	shape: RectangleWidgetShape;
	definition: RegisteredWidgetDefinition;
} ) {
	const editor = useEditor();
	const isEditing = useIsEditing( shape.id );
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
		<WidgetComponent
			id={ getWidgetIdFromShapeId( shape.id ) }
			widgetProps={ shape.props.widgetProps }
			isEditing={ isEditing }
			onWidgetPropsChange={ handleWidgetPropsChange }
			onEditComplete={ () => editor.complete() }
		/>
	);
}

function getWidgetIdFromShapeId( shapeId: string ) {
	return shapeId.startsWith( 'shape:' ) ? shapeId.slice( 'shape:'.length ) : shapeId;
}
