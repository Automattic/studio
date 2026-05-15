import { __ } from '@wordpress/i18n';
import { color } from '@wordpress/icons';
import {
	ColorWidgetComponent,
	ColorWidgetThumbnailComponent,
	indicatorShade,
} from '@/ui-desks/widgets/color/component';
import { ColorToolbarControl } from '@/ui-desks/widgets/color/toolbar-control';
import { COLOR_WIDGET_TYPE, isColorWidgetProps, type ColorWidget } from './types';
import type { WidgetDefinition } from '@/ui-desks/widgets/types';

export const colorWidgetDefinition = {
	type: COLOR_WIDGET_TYPE,
	name: () => __( 'Color' ),
	Component: ColorWidgetComponent,
	thumbnail: ColorWidgetThumbnailComponent,
	isCreatable: false,
	isWidgetProps: isColorWidgetProps,
	controls: [
		{
			type: 'custom',
			id: 'copy-color',
			Component: ColorToolbarControl,
		},
	],
	getIndicator: ( widgetProps ) => ( {
		cornerRadius: 14,
		stroke: indicatorShade( widgetProps.color ),
	} ),
	labels: {
		add: () => __( 'Color' ),
	},
	icon: color,
	getInitialWidget: () => ( {
		shapeProps: {
			w: 140,
			h: 140,
		},
		widgetProps: {
			color: '#111111',
			title: '',
		},
	} ),
	getSummary: ( widgetProps ) => widgetProps.title || widgetProps.color,
	getStackExpandedLayout: ( { members, anchor } ) => {
		if ( members.length < 5 ) {
			return null;
		}

		const sizes = members.map( ( { shape } ) => getShapeSize( shape ) );
		const maxSize = Math.max( ...sizes.map( ( size ) => Math.max( size.w, size.h ) ) );
		const desiredGap = 30;
		const radius = Math.max(
			maxSize * 1.1,
			( members.length * ( maxSize + desiredGap ) ) / ( 2 * Math.PI )
		);

		return members.map( ( _member, index ) => {
			const angle = ( 2 * Math.PI * index ) / members.length - Math.PI / 2;
			const centerX = anchor.x + Math.cos( angle ) * radius;
			const centerY = anchor.y + Math.sin( angle ) * radius;
			const size = sizes[ index ];
			const rotation = angle + Math.PI / 2;
			const cos = Math.cos( rotation );
			const sin = Math.sin( rotation );
			const halfWidth = size.w / 2;
			const halfHeight = size.h / 2;

			return {
				x: centerX - halfWidth * cos + halfHeight * sin,
				y: centerY - halfWidth * sin - halfHeight * cos,
				rotation,
			};
		} );
	},
} satisfies WidgetDefinition< ColorWidget >;

function getShapeSize( shape: { props: unknown } ) {
	const shapeProps = ( shape.props as { shapeProps?: { w?: unknown; h?: unknown } } ).shapeProps;

	return {
		w: typeof shapeProps?.w === 'number' ? shapeProps.w : 100,
		h: typeof shapeProps?.h === 'number' ? shapeProps.h : 100,
	};
}
