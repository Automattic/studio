import type {
	AiSessionSummary,
	LoadedAiSession,
	SessionEntry,
	SiteDetails,
	SiteStorageUsage,
} from '@/data/core';

export const PRIMARY_SITE_ID = 'meridian';
export const AGENT_COMPLETE_SESSION_ID = 'marketing-agent-complete';

function svgDataUrl( svg: string ): string {
	return `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( svg ) }`;
}

const meridianIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" rx="14" fill="#1f493d"/>
		<path d="M17 43V21h7l8 11 8-11h7v22h-7V31l-8 10-8-10v12z" fill="#f4e9ce"/>
	</svg>
` );

const juniperIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" rx="14" fill="#72583d"/>
		<path d="M19 45c13-1 22-9 26-27-16 4-24 13-26 27z" fill="#f7e6bd"/>
		<path d="M23 40c6-7 12-12 19-17" fill="none" stroke="#72583d" stroke-width="3" stroke-linecap="round"/>
	</svg>
` );

const atlasIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" rx="14" fill="#314c72"/>
		<circle cx="32" cy="32" r="17" fill="none" stroke="#dceaff" stroke-width="4"/>
		<path d="M15 32h34M32 15c6 6 9 11 9 17s-3 11-9 17c-6-6-9-11-9-17s3-11 9-17z" fill="none" stroke="#dceaff" stroke-width="3"/>
	</svg>
` );

export const MERIDIAN_THUMBNAIL = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760">
		<rect width="1200" height="760" fill="#f5f0e5"/>
		<rect x="0" y="0" width="1200" height="72" fill="#173f35"/>
		<circle cx="56" cy="36" r="16" fill="#e6be75"/>
		<text x="88" y="44" fill="#fffaf0" font-size="25" font-family="Arial, sans-serif" font-weight="700">MERIDIAN</text>
		<text x="785" y="42" fill="#d9e7df" font-size="15" font-family="Arial, sans-serif">STORY     MENU     VISIT</text>
		<rect x="44" y="110" width="1112" height="448" rx="22" fill="#cf8b56"/>
		<path d="M44 424c146-107 278-149 398-128 120 21 193 99 321 87 121-11 218-94 393-102v277H44z" fill="#dba172"/>
		<circle cx="884" cy="227" r="118" fill="#efd7ad" opacity=".8"/>
		<text x="95" y="230" fill="#173f35" font-size="21" font-family="Arial, sans-serif" font-weight="700">COFFEE, ROASTED WITH INTENTION</text>
		<text x="92" y="308" fill="#fffaf0" font-size="67" font-family="Georgia, serif" font-weight="700">Make room for</text>
		<text x="92" y="382" fill="#fffaf0" font-size="67" font-family="Georgia, serif" font-weight="700">a better morning.</text>
		<rect x="94" y="428" width="170" height="52" rx="26" fill="#173f35"/>
		<text x="134" y="461" fill="#fffaf0" font-size="17" font-family="Arial, sans-serif" font-weight="700">SHOP COFFEE</text>
		<rect x="44" y="592" width="348" height="122" rx="16" fill="#fffaf0"/>
		<rect x="426" y="592" width="348" height="122" rx="16" fill="#e7dfcd"/>
		<rect x="808" y="592" width="348" height="122" rx="16" fill="#173f35"/>
		<text x="74" y="635" fill="#735c45" font-size="14" font-family="Arial, sans-serif">01  SMALL-BATCH</text>
		<text x="74" y="678" fill="#173f35" font-size="25" font-family="Georgia, serif">Roasted every week</text>
		<text x="456" y="635" fill="#735c45" font-size="14" font-family="Arial, sans-serif">02  RESPONSIBLY SOURCED</text>
		<text x="456" y="678" fill="#173f35" font-size="25" font-family="Georgia, serif">Built on relationships</text>
		<text x="838" y="635" fill="#d0b783" font-size="14" font-family="Arial, sans-serif">03  FREE SHIPPING</text>
		<text x="838" y="678" fill="#fffaf0" font-size="25" font-family="Georgia, serif">On orders over $40</text>
	</svg>
` );

const BASE_SITES: readonly SiteDetails[] = [
	{
		id: PRIMARY_SITE_ID,
		name: 'Meridian Coffee',
		path: '/Studio/meridian-coffee',
		port: 8881,
		running: false,
		customDomain: 'meridian.local',
		enableHttps: true,
		phpVersion: '8.3',
		isWpAutoUpdating: true,
		adminUsername: 'admin',
		adminEmail: 'studio@example.test',
		sortOrder: 1000,
		themeDetails: {
			name: 'Meridian',
			path: '/Studio/meridian-coffee/wp-content/themes/meridian',
			slug: 'meridian',
			isBlockTheme: true,
		},
		siteIcon: meridianIcon,
	},
	{
		id: 'juniper-journal',
		name: 'Juniper Journal',
		path: '/Studio/juniper-journal',
		port: 8882,
		running: true,
		customDomain: 'juniper.local',
		phpVersion: '8.3',
		isWpAutoUpdating: true,
		sortOrder: 2000,
		themeDetails: {
			name: 'Juniper',
			path: '/Studio/juniper-journal/wp-content/themes/juniper',
			slug: 'juniper',
			isBlockTheme: true,
		},
		siteIcon: juniperIcon,
	},
	{
		id: 'atlas-creative',
		name: 'Atlas Creative',
		path: '/Studio/atlas-creative',
		port: 8883,
		running: true,
		customDomain: 'atlas.local',
		phpVersion: '8.2',
		isWpAutoUpdating: true,
		sortOrder: 3000,
		themeDetails: {
			name: 'Twenty Twenty-Six',
			path: '/Studio/atlas-creative/wp-content/themes/twentytwentysix',
			slug: 'twentytwentysix',
			isBlockTheme: true,
		},
		siteIcon: atlasIcon,
	},
];

export const PRIMARY_SITE_STORAGE: SiteStorageUsage = {
	total: 191_889_408,
	uploads: 105_906_176,
	plugins: 36_700_160,
	themes: 18_874_368,
	database: 15_728_640,
	other: 14_680_064,
};

const AGENT_COMPLETE_SUMMARY: AiSessionSummary = {
	id: AGENT_COMPLETE_SESSION_ID,
	filePath: '/marketing/sessions/agent-complete.jsonl',
	createdAt: '2026-08-08T14:00:00.000Z',
	updatedAt: '2026-08-08T14:04:00.000Z',
	firstPrompt: 'Refresh the homepage so the coffee brand feels warmer and more premium.',
	assistantReplyPreview:
		'Done — I refreshed the homepage and checked it at desktop and mobile sizes.',
	ownerSiteId: PRIMARY_SITE_ID,
	ownerSitePath: '/Studio/meridian-coffee',
	ownerSiteName: 'Meridian Coffee',
	selectedSiteName: 'Meridian Coffee',
	activeEnvironment: 'local',
	eventCount: 7,
};

const AGENT_COMPLETE_ENTRIES: SessionEntry[] = [
	{
		type: 'custom',
		id: 'marketing-user-prompt',
		parentId: null,
		timestamp: '2026-08-08T14:00:00.000Z',
		customType: 'studio.user_prompt',
		data: {
			text: 'Refresh the homepage so the coffee brand feels warmer and more premium. Keep the layout focused and make sure it works well on mobile.',
			source: 'prompt',
			sitePath: '/Studio/meridian-coffee',
		},
	} as SessionEntry,
	{
		type: 'message',
		id: 'marketing-read-theme',
		parentId: null,
		timestamp: '2026-08-08T14:00:18.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'marketing-tool-read',
					name: 'Read',
					arguments: { file_path: '/Studio/meridian-coffee/wp-content/themes/meridian/theme.json' },
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-read-result',
		parentId: null,
		timestamp: '2026-08-08T14:00:19.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-tool-read',
			content: [ { type: 'text', text: 'Theme settings and homepage template loaded.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-update-homepage',
		parentId: null,
		timestamp: '2026-08-08T14:02:05.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'marketing-tool-wp-cli',
					name: 'wp_cli',
					arguments: {
						nameOrPath: 'Meridian Coffee',
						command: 'post update 12 --post_content=<homepage-pattern>',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-update-result',
		parentId: null,
		timestamp: '2026-08-08T14:02:07.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-tool-wp-cli',
			content: [ { type: 'text', text: 'Success: Updated post 12.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-assistant-complete',
		parentId: null,
		timestamp: '2026-08-08T14:04:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'Done — I refreshed the homepage with a warmer editorial palette, a clearer hero, and more focused calls to action. I also tightened the spacing and type scale for mobile.\n\nThe updated design is ready to review in the preview.',
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'custom',
		id: 'marketing-turn-complete',
		parentId: null,
		timestamp: '2026-08-08T14:04:01.000Z',
		customType: 'studio.turn_closed',
		data: { status: 'success' },
	} as SessionEntry,
];

export function getMarketingSites(): SiteDetails[] {
	return BASE_SITES.map( ( site ) => ( {
		...site,
		themeDetails: site.themeDetails ? { ...site.themeDetails } : undefined,
	} ) );
}

export function getMarketingSessions(): AiSessionSummary[] {
	return [ { ...AGENT_COMPLETE_SUMMARY } ];
}

export function getMarketingSession( sessionId: string ): LoadedAiSession {
	if ( sessionId !== AGENT_COMPLETE_SESSION_ID ) {
		throw new Error( `Unknown marketing session "${ sessionId }".` );
	}
	return {
		summary: { ...AGENT_COMPLETE_SUMMARY },
		entries: [ ...AGENT_COMPLETE_ENTRIES ],
	};
}
