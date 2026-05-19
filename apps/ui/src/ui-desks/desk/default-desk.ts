import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { POST_COLLECTION_WIDGET_TYPE } from '@/ui-desks/widgets/post-collection/types';
import { getScratchpadShapePropsForScope } from '@/ui-desks/widgets/scratchpad/sizing';
import { SCRATCHPAD_WIDGET_TYPE } from '@/ui-desks/widgets/scratchpad/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { THEME_CARD_SHAPE_PROPS, THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';

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

export function createDefaultSiteDeskConfig(): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		widgets: [
			{
				id: 'site-card',
				type: SITE_CARD_WIDGET_TYPE,
				x: 96,
				y: 96,
				zIndex: 'a1',
				shapeProps: {
					w: 360,
					h: 200,
				},
				widgetProps: {
					previewVisible: false,
				},
			},
			{
				id: 'home-preview',
				type: SITE_PREVIEW_WIDGET_TYPE,
				x: 496,
				y: 96,
				zIndex: 'a2',
				shapeProps: {
					w: 640,
					h: 460,
				},
				widgetProps: {
					path: '/',
				},
			},
			{
				id: 'site-notes',
				type: NOTE_WIDGET_TYPE,
				x: 96,
				y: 328,
				zIndex: 'a3',
				shapeProps: {
					w: 240,
					h: 180,
				},
				widgetProps: {
					text: 'Ideas / TODO',
					tone: 'yellow',
				},
			},
			{
				id: 'recent-posts',
				type: POST_COLLECTION_WIDGET_TYPE,
				x: 96,
				y: 560,
				zIndex: 'a4',
				shapeProps: {
					w: 1,
					h: 1,
				},
				widgetProps: {
					query: {
						postType: 'post',
						perPage: 5,
						status: 'publish',
						orderby: 'date',
						order: 'desc',
					},
				},
			},
			{
				id: 'active-theme',
				type: THEME_WIDGET_TYPE,
				x: 496,
				y: 600,
				zIndex: 'a5',
				shapeProps: {
					...THEME_CARD_SHAPE_PROPS,
				},
				widgetProps: {
					viewMode: 'stack',
				},
			},
		],
	};
}
