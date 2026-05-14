import type { RectangleWidgetShapeProps } from '@/ui-desks/widget-actions/geometry';
import type { ArtefactScope, ArtefactWidgetProps } from '@/ui-desks/widgets/artefact/types';

const ARTEFACT_PADDING = 44;
const ARTEFACT_DESCRIPTION_GAP = 28;
const ARTEFACT_DESCRIPTION_HEIGHT = 48;

const ARTEFACT_VIEWPORTS: Record< ArtefactScope, RectangleWidgetShapeProps > = {
	page: { w: 1024, h: 768 },
	pattern: { w: 600, h: 200 },
	block: { w: 480, h: 360 },
};

export const ARTEFACT_DEFAULT_SHAPE_PROPS = getArtefactShapePropsForScope( 'block' );

export function getArtefactShapePropsForScope( scope: ArtefactScope ): RectangleWidgetShapeProps {
	const viewport = ARTEFACT_VIEWPORTS[ scope ];
	return {
		w: viewport.w + ARTEFACT_PADDING * 2,
		h: viewport.h + ARTEFACT_PADDING * 2 + ARTEFACT_DESCRIPTION_GAP + ARTEFACT_DESCRIPTION_HEIGHT,
	};
}

export async function getFittedArtefactShapeProps( {
	widgetProps,
}: {
	widgetProps: ArtefactWidgetProps;
	shapeProps: RectangleWidgetShapeProps;
} ): Promise< RectangleWidgetShapeProps | null > {
	if ( typeof document === 'undefined' || ! widgetProps.html ) {
		return getArtefactShapePropsForScope( widgetProps.scope );
	}

	const viewport = ARTEFACT_VIEWPORTS[ widgetProps.scope ];
	const measured = await measureArtefactSize( widgetProps.html, viewport );

	return {
		w: measured.w + ARTEFACT_PADDING * 2,
		h: measured.h + ARTEFACT_PADDING * 2 + ARTEFACT_DESCRIPTION_GAP + ARTEFACT_DESCRIPTION_HEIGHT,
	};
}

function measureArtefactSize( html: string, viewport: RectangleWidgetShapeProps ) {
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
