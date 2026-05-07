import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	resizeBox,
	type RecordProps,
	type TLResizeInfo,
} from 'tldraw';
import { NoteWidgetComponent } from '@/ui-desks/widgets/note/component';
import { NOTE_WIDGET_CANVAS_TYPE, type NoteShape } from '@/ui-desks/widgets/note/types';

export class NoteShapeUtil extends ShapeUtil< NoteShape > {
	static override type = NOTE_WIDGET_CANVAS_TYPE;

	static override props: RecordProps< NoteShape > = {
		w: T.number,
		h: T.number,
		text: T.string,
		color: T.literalEnum( 'yellow', 'blue', 'green', 'pink' ),
	};

	override getDefaultProps(): NoteShape[ 'props' ] {
		return {
			w: 260,
			h: 220,
			text: '',
			color: 'yellow',
		};
	}

	override canResize(): boolean {
		return true;
	}

	override canEdit(): boolean {
		return true;
	}

	override getGeometry( shape: NoteShape ) {
		return new Rectangle2d( {
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		} );
	}

	override onResize( shape: NoteShape, info: TLResizeInfo< NoteShape > ) {
		return resizeBox( shape, info );
	}

	override component( shape: NoteShape ) {
		return (
			<HTMLContainer
				style={ {
					width: shape.props.w,
					height: shape.props.h,
					pointerEvents: 'all',
				} }
			>
				<NoteWidgetComponent id={ shape.id } props={ shape.props } />
			</HTMLContainer>
		);
	}

	override indicator( shape: NoteShape ) {
		return <rect width={ shape.props.w } height={ shape.props.h } rx={ 18 } ry={ 18 } />;
	}
}
