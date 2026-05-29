import { DESK_CONFIG_VERSION, type DeskConfig } from '@/ui-desks/desk/types';
import { DRAWING_WIDGET_TYPE } from '@/ui-desks/widgets/drawing/types';
import { EMBED_WIDGET_TYPE } from '@/ui-desks/widgets/embed/types';
import { NOTE_WIDGET_TYPE } from '@/ui-desks/widgets/note/types';
import { SITE_CARD_WIDGET_TYPE } from '@/ui-desks/widgets/site-card/types';
import { SITE_PREVIEW_WIDGET_TYPE } from '@/ui-desks/widgets/site-preview/types';
import { SITE_SHORTCUTS_WIDGET_TYPE } from '@/ui-desks/widgets/site-shortcuts/types';
import { THEME_WIDGET_TYPE } from '@/ui-desks/widgets/theme/types';

const STUDIO_TOUR_VIDEO_URL = 'https://www.youtube.com/watch?v=2MV17Qzj_T0';
const USER_DESK_DRAWING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" direction="ltr" width="117.24944025323262" height="148.5201675306975" viewBox="74.86774724676738 80.6478012193025 117.24944025323262 148.5201675306975" stroke-linecap="round" stroke-linejoin="round" data-color-mode="light" class="tl-container tl-theme__force-sRGB tl-theme__light" style="background-color: transparent;"><defs/><g transform="matrix(1, 0, 0, 1, 176.1172, 213.168)" opacity="1"><g transform="scale(1)"><path d="M-1.9473,2.1467 T-3.3582,0.7423 -7.0433,-2.9429 -13.2165,-9.1322 -21.777,-17.9041 -31.0066,-27.7922 -40.1041,-38.1427 -48.8066,-49.0082 -56.607,-59.8478 -63.1764,-69.7224 -68.4489,-78.1036 -72.6051,-84.9961 -75.868,-90.4811 -78.4464,-94.6229 -80.4826,-97.5222 -82.9751,-100.7375 -84.5727,-102.7965 A2.2842,2.2842 0 0 1 -80.8073,-105.3835 T-79.4508,-103.1427 -77.3259,-99.6024 -75.4296,-96.4953 -72.8496,-92.2868 -69.5722,-86.8312 -65.4192,-80.0161 -60.1536,-71.7414 -53.6047,-62.0213 -45.8489,-51.4013 -37.1626,-40.7658 -28.0174,-30.6368 -18.6918,-21.01 -9.9754,-12.5596 -3.5515,-6.7552 0.4124,-3.4144 1.9473,-2.1467 A2.8983,2.8983 0 0 1 -1.9473,2.1467 Z" stroke-linecap="round" fill="#1d1d1d"/></g></g><g transform="matrix(1, 0, 0, 1, 95.1953, 149.0352)" opacity="1"><g transform="scale(1)"><path d="M-2.7945,0 T-2.7659,-1.6804 -2.6056,-5.8891 -2.3744,-11.7172 -2.2008,-18.3282 -2.072,-24.501 -1.9772,-29.7194 -1.9899,-33.826 -2.1936,-38.0398 -2.5589,-42.1675 -3.6004,-45.6549 -5.5543,-49.0297 -6.6812,-50.5804 A3.103,3.103 0 0 1 -1.6359,-54.1943 T-0.8458,-52.8465 0.7158,-49.8531 1.9373,-46.2606 2.3658,-42.4089 2.1936,-38.0398 1.9899,-33.826 1.9772,-29.7194 2.072,-24.501 2.2008,-18.3282 2.3744,-11.7172 2.6056,-5.8891 2.7659,-1.6804 2.7945,0 A2.7945,2.7945 0 0 1 -2.7945,0 ZM-3.4485,-49.3666 T-3.4936,-49.3522 -3.5387,-49.3377 A3.1106,3.1106 0 0 1 -4.9621,-55.3938 T-4.9153,-55.4009 -4.8685,-55.4081 A3.103,3.103 0 0 1 -3.4485,-49.3666 ZM-1.4093,-53.6322 T-1.3703,-53.4149 0.3515,-52.2862 3.4653,-50.4949 6.6218,-48.5429 10.1415,-46.4815 13.7179,-44.5733 17.008,-42.941 20.7011,-41.2204 24.0512,-39.6188 25.2163,-39.0244 A2.7357,2.7357 0 0 1 22.6437,-34.1956 T21.5005,-34.831 18.3584,-36.5717 14.8563,-38.3907 11.4944,-39.9034 7.6292,-41.5381 3.7228,-43.2401 -0.6773,-45.3962 -4.523,-47.6508 -6.48,-49.8573 -7.0915,-51.0993 A3.1106,3.1106 0 0 1 -1.4093,-53.6322 Z" stroke-linecap="round" fill="#1d1d1d"/></g></g></svg>`;

export const defaultUserDesk: DeskConfig = {
	version: DESK_CONFIG_VERSION,
	updatedAt: new Date().toISOString(),
	viewport: {
		x: 20,
		y: 11,
		z: 1,
	},
	widgets: [
		{
			id: 'create-site-note',
			type: NOTE_WIDGET_TYPE,
			x: 184,
			y: 162,
			zIndex: 'a1AMA',
			shapeProps: {
				w: 320,
				h: 164,
			},
			widgetProps: {
				text: '<strong>Start with Create</strong><br>Use the + button to create a local WordPress site, import an existing project, or add links, notes, drawings, and site cards to this desk.',
				tone: 'neon-green',
				textSize: 1,
			},
		},
		{
			id: 'welcome-note',
			type: NOTE_WIDGET_TYPE,
			x: 544,
			y: 128,
			zIndex: 'a2BZf',
			shapeProps: {
				w: 360,
				h: 264,
			},
			widgetProps: {
				text: '<strong>Welcome to your Studio desk</strong><br><br>This is your home base for local WordPress work. Keep sites, references, notes, and experiments in one place so every project has context.',
				tone: 'yellow',
				textSize: 1,
			},
		},
		{
			id: 'studio-tour-video',
			type: EMBED_WIDGET_TYPE,
			x: 544,
			y: 440,
			zIndex: 'a31Lh',
			shapeProps: {
				w: 520,
				h: 292.5,
			},
			widgetProps: {
				url: STUDIO_TOUR_VIDEO_URL,
			},
		},
		{
			id: 'chat-note',
			type: NOTE_WIDGET_TYPE,
			x: 948,
			y: 128,
			zIndex: 'a40CN',
			shapeProps: {
				w: 312,
				h: 212,
			},
			widgetProps: {
				text: '<strong>Try Chat</strong><br>Ask Studio to explain what you are seeing, plan a change, draft content, or use selected desk widgets as context for the next step.',
				tone: 'blue',
				textSize: 1,
			},
		},
		{
			id: 'sites-note',
			type: NOTE_WIDGET_TYPE,
			x: 184,
			y: 376,
			zIndex: 'a59uw',
			shapeProps: {
				w: 320,
				h: 236,
			},
			widgetProps: {
				text: '<strong>Bring sites onto the desk</strong><br>After you create a site, add its site card here. From there you can open the preview, jump into WP Admin, sync, and keep per-site notes nearby.',
				tone: 'violet',
				textSize: 1,
			},
		},
		{
			id: '418a66ef-52f8-4f32-a819-f0dc1cc9e32a',
			type: DRAWING_WIDGET_TYPE,
			x: 74.8677472467674,
			y: 80.6478012193025,
			zIndex: 'a6BMN',
			shapeProps: {
				w: 117.24944025323262,
				h: 148.5201675306975,
			},
			widgetProps: {
				svg: USER_DESK_DRAWING_SVG,
			},
		},
	],
};

export function createDefaultSiteDeskConfig(): DeskConfig {
	return {
		version: DESK_CONFIG_VERSION,
		updatedAt: new Date().toISOString(),
		viewport: {
			x: 419.18831968677756,
			y: 98.5921921662651,
			z: 0.6035527097673408,
		},
		widgets: [
			{
				id: 'site-card',
				type: SITE_CARD_WIDGET_TYPE,
				x: 184.83596516477996,
				y: 101.06117767440315,
				zIndex: 'a04MU',
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
				zIndex: 'a17Zw',
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
				zIndex: 'a27H4',
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
				zIndex: 'a34je',
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
				zIndex: 'a4A6S',
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
				id: 'site-shortcuts',
				type: SITE_SHORTCUTS_WIDGET_TYPE,
				x: 181.3992831377875,
				y: 688.0537779757126,
				zIndex: 'a5CE6',
				shapeProps: {
					w: 363.3217408954813,
					h: 538.6254582619412,
				},
				widgetProps: {},
			},
			{
				id: 'e60190a0-d2df-4c16-b283-eb19ed8e4839',
				type: NOTE_WIDGET_TYPE,
				x: 183.78101380809494,
				y: 336.58687589714395,
				zIndex: 'a62yJ',
				shapeProps: {
					w: 360,
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
