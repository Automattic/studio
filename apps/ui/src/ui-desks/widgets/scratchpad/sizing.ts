import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { ScratchpadScope, ScratchpadWidgetProps } from '@/ui-desks/widgets/scratchpad/types';

const SCRATCHPAD_PADDING = 44;
const SCRATCHPAD_DESCRIPTION_GAP = 28;
const SCRATCHPAD_DESCRIPTION_HEIGHT = 48;

const SCRATCHPAD_VIEWPORTS: Record< ScratchpadScope, RectangleWidgetShapeProps > = {
	page: { w: 1024, h: 768 },
	pattern: { w: 600, h: 200 },
	block: { w: 480, h: 360 },
};

export const SCRATCHPAD_DEFAULT_SHAPE_PROPS = { ...SCRATCHPAD_VIEWPORTS.block };

export function getScratchpadShapePropsForScope(
	scope: ScratchpadScope
): RectangleWidgetShapeProps {
	const viewport = SCRATCHPAD_VIEWPORTS[ scope ];
	return {
		w: viewport.w + SCRATCHPAD_PADDING * 2,
		h:
			viewport.h +
			SCRATCHPAD_PADDING * 2 +
			SCRATCHPAD_DESCRIPTION_GAP +
			SCRATCHPAD_DESCRIPTION_HEIGHT,
	};
}

export async function getFittedScratchpadShapeProps( {
	widgetProps,
}: {
	widgetProps: ScratchpadWidgetProps;
	shapeProps: RectangleWidgetShapeProps;
} ): Promise< RectangleWidgetShapeProps | null > {
	if ( typeof document === 'undefined' || ! widgetProps.html ) {
		return { ...SCRATCHPAD_DEFAULT_SHAPE_PROPS };
	}

	const viewport = SCRATCHPAD_VIEWPORTS[ widgetProps.scope ];
	const measured = await measureScratchpadSize( widgetProps.html, viewport );

	return {
		w: measured.w + SCRATCHPAD_PADDING * 2,
		h:
			measured.h +
			SCRATCHPAD_PADDING * 2 +
			SCRATCHPAD_DESCRIPTION_GAP +
			SCRATCHPAD_DESCRIPTION_HEIGHT,
	};
}

function measureScratchpadSize( html: string, viewport: RectangleWidgetShapeProps ) {
	return new Promise< RectangleWidgetShapeProps >( ( resolve ) => {
		const iframe = document.createElement( 'iframe' );
		iframe.style.cssText = [
			'position:fixed',
			'top:-99999px',
			'left:0',
			`width:${ viewport.w }px`,
			`height:${ viewport.h }px`,
			'border:0',
			'visibility:hidden',
		].join( ';' );
		iframe.sandbox.add( 'allow-same-origin' );
		iframe.srcdoc = html;
		document.body.appendChild( iframe );

		let didResolve = false;
		const finish = () => {
			if ( didResolve ) {
				return;
			}
			didResolve = true;

			const body = iframe.contentDocument?.body;
			const root = iframe.contentDocument?.documentElement;
			const scrollHeight = Math.max( body?.scrollHeight ?? 0, root?.scrollHeight ?? 0, viewport.h );
			iframe.remove();

			resolve( {
				w: viewport.w,
				h: Math.min( scrollHeight, viewport.h * 3 ),
			} );
		};

		iframe.addEventListener( 'load', () => {
			window.setTimeout( finish, 60 );
		} );
		window.setTimeout( finish, 800 );
	} );
}
