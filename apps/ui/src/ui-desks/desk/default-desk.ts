import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { BOOKMARK_WIDGET_TYPE } from '@/ui-desks/widgets/bookmark/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { getScratchpadShapePropsForScope } from '@/ui-desks/widgets/scratchpad/sizing';
import { SCRATCHPAD_WIDGET_TYPE } from '@/ui-desks/widgets/scratchpad/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';

const EXAMPLE_SCRATCHPAD_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
	* {
		box-sizing: border-box;
	}

	body {
		margin: 0;
		min-height: 100vh;
		display: grid;
		place-items: center;
		background: linear-gradient(135deg, #f8fafc, #fef3c7);
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
		color: #14171a;
	}

	main {
		width: min(360px, calc(100vw - 48px));
		padding: 32px;
		border-radius: 14px;
		background: #fff;
		box-shadow: 0 18px 44px rgba(15, 23, 42, 0.12);
		text-align: center;
	}

	h1 {
		margin: 0 0 12px;
		font-size: 30px;
		line-height: 1.1;
	}

	p {
		margin: 0;
		color: #4b5563;
		font-size: 15px;
		line-height: 1.5;
	}
</style>
</head>
<body>
	<main>
		<h1>Scratchpad preview</h1>
		<p>This HTML is rendered inside an iframe on the desk canvas.</p>
	</main>
</body>
</html>`;

export const defaultUserDesk: DeskConfig = {
	version: DESK_CONFIG_VERSION,
	updatedAt: new Date().toISOString(),
	widgets: [
		{
			id: 'welcome-note',
			type: 'note',
			x: 160,
			y: 120,
			zIndex: 'a1',
			shapeProps: {
				w: 200,
				h: 200,
			},
			widgetProps: {
				text: '',
				tone: 'yellow',
			},
		},
		{
			id: 'example-scratchpad',
			type: SCRATCHPAD_WIDGET_TYPE,
			x: 420,
			y: 80,
			zIndex: 'a2',
			shapeProps: getScratchpadShapePropsForScope( 'block' ),
			widgetProps: {
				html: EXAMPLE_SCRATCHPAD_HTML,
				title: 'Example scratchpad',
				scope: 'block',
				description: 'Sample HTML scratchpad for testing iframe rendering and prompt editing.',
			},
		},
	],
};

export function createDefaultSiteDeskConfig( siteUrl = '' ): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: {
			x: 440.72744922694875,
			y: 53.85707696744839,
			z: 0.6035527097673408,
		},
		widgets: [
			{
				id: 'site-card',
				type: SITE_CARD_WIDGET_TYPE,
				x: 184.83596516477996,
				y: 101.06117767440315,
				zIndex: 'a00xF',
				shapeProps: {
					w: 360,
					h: 200,
				},
				widgetProps: {
					previewVisible: false,
				},
			},
			{
				id: 'active-theme',
				type: THEME_WIDGET_TYPE,
				x: 631.6308732298062,
				y: 785.2649837045076,
				zIndex: 'a1BoL',
				shapeProps: {
					w: 760,
					h: 440,
				},
				widgetProps: {
					viewMode: 'stack',
				},
			},
			{
				id: 'home-preview',
				type: SITE_PREVIEW_WIDGET_TYPE,
				x: 634.5565745594427,
				y: 98.47227110772417,
				zIndex: 'a21Yp',
				shapeProps: {
					w: 754.6531489796062,
					h: 603.3094530012401,
				},
				widgetProps: {
					path: '/',
				},
			},
			{
				id: 'site-notes',
				type: NOTE_WIDGET_TYPE,
				x: 1278.0300192133188,
				y: 659.9530248690811,
				zIndex: 'a32wj',
				shapeProps: {
					w: 164.11440409609554,
					h: 80,
				},
				widgetProps: {
					text: 'Site Preview',
					tone: 'neon-blue',
					textSize: 2,
				},
			},
			{
				id: '2f456fe8-0351-49ec-b816-3629382036a3',
				type: NOTE_WIDGET_TYPE,
				x: 1269.3487977572597,
				y: 1177.163284949601,
				zIndex: 'a49JE',
				shapeProps: {
					w: 160.64603845116085,
					h: 80,
				},
				widgetProps: {
					text: 'Theme',
					tone: 'violet',
					textSize: 2,
				},
			},
			{
				id: '5efaab75-bd70-4332-bdf1-e1183e78331f',
				type: BOOKMARK_WIDGET_TYPE,
				x: 246.437937197667,
				y: 333.81664542698036,
				zIndex: 'a516A',
				shapeProps: {
					w: 300,
					h: 101,
				},
				widgetProps: {
					url: normalizeDefaultSiteDeskUrl( siteUrl ),
				},
			},
			{
				id: 'e60190a0-d2df-4c16-b283-eb19ed8e4839',
				type: NOTE_WIDGET_TYPE,
				x: 237.7295705934331,
				y: 470.6123135830188,
				zIndex: 'a61Ch',
				shapeProps: {
					w: 304.9708960372699,
					h: 316,
				},
				widgetProps: {
					text: "<strong>Welcome to your Site's desk, y</strong><strong>ou can do a lot from here<br><br></strong> - Add post collections<br> - Paste links, media<br> - Iterate on your site with AI<br> - Preview and deploy<br><br> and a lot more...",
					tone: 'yellow',
					textSize: 1,
				},
			},
		],
	};
}

function normalizeDefaultSiteDeskUrl( url: string ) {
	const trimmedUrl = url.trim();
	if ( ! trimmedUrl ) {
		return '';
	}

	return trimmedUrl.endsWith( '/' ) ? trimmedUrl : `${ trimmedUrl }/`;
}
