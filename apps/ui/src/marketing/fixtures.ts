import type {
	ActiveAgentRun,
	AiSessionSummary,
	LoadedAiSession,
	SessionEntry,
	SiteDetails,
	SiteStorageUsage,
	Snapshot,
	SyncSite,
} from '@/data/core';

export const PRIMARY_SITE_ID = 'meridian';
export const AGENT_NEW_SESSION_ID = 'marketing-agent-new';
export const AGENT_WORKING_SESSION_ID = 'marketing-agent-working';
export const AGENT_COMPLETE_SESSION_ID = 'marketing-agent-complete';
export const AGENT_LONG_SESSION_ID = 'marketing-agent-long';
export const AGENT_WORKING_RUN_ID = 'marketing-agent-working-run';

function svgDataUrl( svg: string ): string {
	return `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( svg ) }`;
}

const meridianIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" fill="#1f493d"/>
		<path d="M17 43V21h7l8 11 8-11h7v22h-7V31l-8 10-8-10v12z" fill="#f4e9ce"/>
	</svg>
` );

const juniperIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" fill="#72583d"/>
		<path d="M19 45c13-1 22-9 26-27-16 4-24 13-26 27z" fill="#f7e6bd"/>
		<path d="M23 40c6-7 12-12 19-17" fill="none" stroke="#72583d" stroke-width="3" stroke-linecap="round"/>
	</svg>
` );

const atlasIcon = svgDataUrl( `
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
		<rect width="64" height="64" fill="#314c72"/>
		<circle cx="32" cy="32" r="17" fill="none" stroke="#dceaff" stroke-width="4"/>
		<path d="M15 32h34M32 15c6 6 9 11 9 17s-3 11-9 17c-6-6-9-11-9-17s3-11 9-17z" fill="none" stroke="#dceaff" stroke-width="3"/>
	</svg>
` );

function monogramIcon( letters: string, background: string, foreground: string ): string {
	return svgDataUrl( `
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
			<rect width="64" height="64" fill="${ background }"/>
			<text x="32" y="40" text-anchor="middle" fill="${ foreground }" font-size="22" font-family="Arial, sans-serif" font-weight="700">${ letters }</text>
		</svg>
	` );
}

const lanternIcon = monogramIcon( 'LB', '#7a3e42', '#fff1d6' );
const northstarIcon = monogramIcon( 'NY', '#395b75', '#e8f5ff' );
const harborIcon = monogramIcon( 'H+P', '#496052', '#f5ecd8' );
const fieldworkIcon = monogramIcon( 'FS', '#5f4b78', '#f1e9ff' );
const commonTableIcon = monogramIcon( 'CT', '#9a5438', '#fff0d6' );

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
	{
		id: 'lantern-books',
		name: 'Lantern Books',
		path: '/Studio/lantern-books',
		port: 8884,
		running: false,
		customDomain: 'lantern.local',
		phpVersion: '8.2',
		isWpAutoUpdating: false,
		sortOrder: 4000,
		themeDetails: {
			name: 'Lantern',
			path: '/Studio/lantern-books/wp-content/themes/lantern',
			slug: 'lantern',
			isBlockTheme: true,
		},
		siteIcon: lanternIcon,
	},
	{
		id: 'northstar-yoga',
		name: 'Northstar Yoga',
		path: '/Studio/northstar-yoga',
		port: 8885,
		running: true,
		customDomain: 'northstar.local',
		enableHttps: true,
		phpVersion: '8.3',
		isWpAutoUpdating: true,
		sortOrder: 5000,
		themeDetails: {
			name: 'Northstar',
			path: '/Studio/northstar-yoga/wp-content/themes/northstar',
			slug: 'northstar',
			isBlockTheme: true,
		},
		siteIcon: northstarIcon,
	},
	{
		id: 'harbor-and-pine',
		name: 'Harbor & Pine',
		path: '/Studio/harbor-and-pine',
		port: 8886,
		running: false,
		customDomain: 'harbor-and-pine.local',
		phpVersion: '8.1',
		isWpAutoUpdating: false,
		sortOrder: 6000,
		themeDetails: {
			name: 'Harbor',
			path: '/Studio/harbor-and-pine/wp-content/themes/harbor',
			slug: 'harbor',
			isBlockTheme: false,
		},
		siteIcon: harborIcon,
	},
	{
		id: 'fieldwork-studio',
		name: 'Fieldwork Studio',
		path: '/Studio/fieldwork-studio',
		port: 8887,
		running: true,
		customDomain: 'fieldwork.local',
		enableHttps: true,
		phpVersion: '8.3',
		isWpAutoUpdating: true,
		sortOrder: 7000,
		themeDetails: {
			name: 'Fieldwork',
			path: '/Studio/fieldwork-studio/wp-content/themes/fieldwork',
			slug: 'fieldwork',
			isBlockTheme: true,
		},
		siteIcon: fieldworkIcon,
	},
	{
		id: 'common-table',
		name: 'Common Table',
		path: '/Studio/common-table',
		port: 8888,
		running: false,
		customDomain: 'common-table.local',
		phpVersion: '8.2',
		isWpAutoUpdating: true,
		sortOrder: 8000,
		themeDetails: {
			name: 'Common Table',
			path: '/Studio/common-table/wp-content/themes/common-table',
			slug: 'common-table',
			isBlockTheme: true,
		},
		siteIcon: commonTableIcon,
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

const AGENT_NEW_SUMMARY: AiSessionSummary = {
	id: AGENT_NEW_SESSION_ID,
	filePath: '/marketing/sessions/agent-new.jsonl',
	createdAt: '2026-08-11T10:00:00.000Z',
	updatedAt: '2026-08-11T10:00:00.000Z',
	ownerSiteId: PRIMARY_SITE_ID,
	ownerSitePath: '/Studio/meridian-coffee',
	ownerSiteName: 'Meridian Coffee',
	activeEnvironment: 'local',
	eventCount: 0,
};

const AGENT_WORKING_SUMMARY: AiSessionSummary = {
	id: AGENT_WORKING_SESSION_ID,
	filePath: '/marketing/sessions/agent-working.jsonl',
	createdAt: '2026-08-11T11:57:00.000Z',
	updatedAt: '2026-08-11T11:59:37.000Z',
	firstPrompt: 'Turn the homepage into a polished launch page for the autumn coffee collection.',
	assistantReplyPreview: 'Updating the homepage layout and color palette…',
	ownerSiteId: PRIMARY_SITE_ID,
	ownerSitePath: '/Studio/meridian-coffee',
	ownerSiteName: 'Meridian Coffee',
	selectedSiteName: 'Meridian Coffee',
	activeEnvironment: 'local',
	eventCount: 5,
};

const AGENT_WORKING_ENTRIES: SessionEntry[] = [
	{
		type: 'custom',
		id: 'marketing-working-prompt',
		parentId: null,
		timestamp: '2026-08-11T11:57:00.000Z',
		customType: 'studio.user_prompt',
		data: {
			text: 'Turn the homepage into a polished launch page for the autumn coffee collection. Keep the warm editorial feel and make the story work beautifully on mobile.',
			source: 'prompt',
			sitePath: '/Studio/meridian-coffee',
		},
	} as SessionEntry,
	{
		type: 'message',
		id: 'marketing-working-plan',
		parentId: null,
		timestamp: '2026-08-11T11:57:12.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'I’ll review the current theme and shape the homepage around the seasonal collection.',
				},
				{
					type: 'toolCall',
					id: 'marketing-working-read',
					name: 'Read',
					arguments: {
						file_path: '/Studio/meridian-coffee/wp-content/themes/meridian/theme.json',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-working-read-result',
		parentId: null,
		timestamp: '2026-08-11T11:57:13.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-working-read',
			content: [ { type: 'text', text: 'Theme settings and homepage template loaded.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-working-update',
		parentId: null,
		timestamp: '2026-08-11T11:59:21.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'marketing-working-wp-cli',
					name: 'wp_cli',
					arguments: {
						nameOrPath: 'Meridian Coffee',
						command: 'post update 12 --post_content=<autumn-launch-pattern>',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'custom',
		id: 'marketing-working-progress',
		parentId: null,
		timestamp: '2026-08-11T11:59:37.000Z',
		customType: 'studio.tool_progress',
		data: { message: 'Updating the homepage layout and color palette…' },
	} as SessionEntry,
];

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

const AGENT_LONG_SUMMARY: AiSessionSummary = {
	id: AGENT_LONG_SESSION_ID,
	filePath: '/marketing/sessions/agent-long.jsonl',
	createdAt: '2026-08-08T14:00:00.000Z',
	updatedAt: '2026-08-08T14:09:00.000Z',
	firstPrompt: 'Refresh the homepage so the coffee brand feels warmer and more premium.',
	assistantReplyPreview:
		'Done — the homepage now has a polished editorial hero, a focused roast collection, and responsive finishing touches.',
	ownerSiteId: PRIMARY_SITE_ID,
	ownerSitePath: '/Studio/meridian-coffee',
	ownerSiteName: 'Meridian Coffee',
	selectedSiteName: 'Meridian Coffee',
	activeEnvironment: 'local',
	eventCount: 13,
};

const AGENT_LONG_ENTRIES: SessionEntry[] = [
	{
		type: 'custom',
		id: 'marketing-long-user-prompt',
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
		id: 'marketing-long-plan',
		parentId: null,
		timestamp: '2026-08-08T14:00:12.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'I’ll review the theme and homepage structure first, then I’ll update the design and check the result at desktop and mobile sizes.',
				},
				{
					type: 'toolCall',
					id: 'marketing-long-read',
					name: 'Read',
					arguments: {
						file_path: '/Studio/meridian-coffee/wp-content/themes/meridian/theme.json',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-read-result',
		parentId: null,
		timestamp: '2026-08-08T14:00:13.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-long-read',
			content: [ { type: 'text', text: 'Theme settings and homepage template loaded.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-update-homepage',
		parentId: null,
		timestamp: '2026-08-08T14:02:05.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'marketing-long-wp-cli',
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
		id: 'marketing-long-update-result',
		parentId: null,
		timestamp: '2026-08-08T14:02:07.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-long-wp-cli',
			content: [ { type: 'text', text: 'Success: Updated post 12.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-first-pass',
		parentId: null,
		timestamp: '2026-08-08T14:04:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'The first pass is ready. I introduced the warmer palette, an editorial hero, and clearer calls to action while preserving the existing product content.',
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'custom',
		id: 'marketing-long-user-follow-up',
		parentId: null,
		timestamp: '2026-08-08T14:05:00.000Z',
		customType: 'studio.user_prompt',
		data: {
			text: 'Great. Bring the featured roasts higher on the page and make the mobile menu feel simpler.',
			source: 'prompt',
			sitePath: '/Studio/meridian-coffee',
		},
	} as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-edit-template',
		parentId: null,
		timestamp: '2026-08-08T14:06:11.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'I’ll tighten that hierarchy and simplify the small-screen navigation.',
				},
				{
					type: 'toolCall',
					id: 'marketing-long-edit',
					name: 'Edit',
					arguments: {
						file_path:
							'/Studio/meridian-coffee/wp-content/themes/meridian/templates/front-page.html',
						old_string: '<!-- wp:group {"className":"featured-roasts"} -->',
						new_string: '<!-- wp:group {"className":"featured-roasts is-priority"} -->',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-edit-result',
		parentId: null,
		timestamp: '2026-08-08T14:06:13.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-long-edit',
			content: [ { type: 'text', text: 'Updated front-page.html.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-cache-flush',
		parentId: null,
		timestamp: '2026-08-08T14:07:31.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'marketing-long-cache-tool',
					name: 'wp_cli',
					arguments: {
						nameOrPath: 'Meridian Coffee',
						command: 'cache flush',
					},
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-cache-result',
		parentId: null,
		timestamp: '2026-08-08T14:07:32.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'marketing-long-cache-tool',
			content: [ { type: 'text', text: 'Success: The cache was flushed.' } ],
		},
	} as unknown as SessionEntry,
	{
		type: 'message',
		id: 'marketing-long-complete',
		parentId: null,
		timestamp: '2026-08-08T14:09:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'text',
					text: 'Done — the featured roasts now follow the hero, the mobile navigation is simpler, and the spacing stays balanced across screen sizes. The updated homepage is ready to review.',
				},
			],
		},
	} as unknown as SessionEntry,
	{
		type: 'custom',
		id: 'marketing-long-turn-complete',
		parentId: null,
		timestamp: '2026-08-08T14:09:01.000Z',
		customType: 'studio.turn_closed',
		data: { status: 'success' },
	} as SessionEntry,
];

const MARKETING_SESSIONS: Readonly< Record< string, LoadedAiSession > > = {
	[ AGENT_NEW_SESSION_ID ]: {
		summary: AGENT_NEW_SUMMARY,
		entries: [],
	},
	[ AGENT_WORKING_SESSION_ID ]: {
		summary: AGENT_WORKING_SUMMARY,
		entries: AGENT_WORKING_ENTRIES,
	},
	[ AGENT_COMPLETE_SESSION_ID ]: {
		summary: AGENT_COMPLETE_SUMMARY,
		entries: AGENT_COMPLETE_ENTRIES,
	},
	[ AGENT_LONG_SESSION_ID ]: {
		summary: AGENT_LONG_SUMMARY,
		entries: AGENT_LONG_ENTRIES,
	},
};

const MARKETING_ACTIVE_RUNS: readonly ActiveAgentRun[] = [
	{
		runId: AGENT_WORKING_RUN_ID,
		sessionId: AGENT_WORKING_SESSION_ID,
		startedAt: Date.parse( '2026-08-11T11:59:37.000Z' ),
		phase: 'running',
	},
];

const CONNECTED_PRESSABLE_SITES: readonly SyncSite[] = [
	{
		id: 8_472_091,
		localSiteId: PRIMARY_SITE_ID,
		name: 'Meridian Coffee',
		url: 'https://meridian-coffee.mystagingwebsite.com',
		isStaging: false,
		isPressable: true,
		environmentType: 'production',
		syncSupport: 'already-connected',
		lastPullTimestamp: '2026-08-09T15:24:00.000Z',
		lastPushTimestamp: '2026-08-10T18:42:00.000Z',
		wpVersion: '6.8.2',
		planName: 'Pressable Signature',
		createdAt: '2025-11-04T17:30:00.000Z',
	},
];

const MARKETING_SNAPSHOTS: readonly Snapshot[] = [
	{
		url: 'meridian-coffee.wpcomstaging.com',
		atomicSiteId: 9_138_204,
		localSiteId: PRIMARY_SITE_ID,
		date: Date.parse( '2026-08-10T16:15:00.000Z' ),
		name: 'Meridian Coffee',
		userId: 2_026_811,
		sequence: 4,
	},
];

export function getMarketingSites(): SiteDetails[] {
	return BASE_SITES.map( ( site ) => ( {
		...site,
		themeDetails: site.themeDetails ? { ...site.themeDetails } : undefined,
	} ) );
}

export function getMarketingSessions( sessionIds: readonly string[] ): AiSessionSummary[] {
	return sessionIds.map( ( sessionId ) => ( { ...getMarketingSession( sessionId ).summary } ) );
}

export function getMarketingSession( sessionId: string ): LoadedAiSession {
	const session = MARKETING_SESSIONS[ sessionId ];
	if ( ! session ) {
		throw new Error( `Unknown marketing session "${ sessionId }".` );
	}
	return {
		summary: { ...session.summary },
		entries: [ ...session.entries ],
	};
}

export function getMarketingActiveAgentRuns( sessionId?: string ): ActiveAgentRun[] {
	return MARKETING_ACTIVE_RUNS.filter( ( run ) => ! sessionId || run.sessionId === sessionId ).map(
		( run ) => ( { ...run } )
	);
}

export function getMarketingConnectedSites( localSiteId?: string ): SyncSite[] {
	return CONNECTED_PRESSABLE_SITES.filter(
		( site ) => ! localSiteId || site.localSiteId === localSiteId
	).map( ( site ) => ( { ...site } ) );
}

export function getMarketingSnapshots(): Snapshot[] {
	return MARKETING_SNAPSHOTS.map( ( snapshot ) => ( { ...snapshot } ) );
}

export function getMarketingRemoteFileTree(): Record< string, unknown > {
	return {
		plugins: { id: 'plugins', type: 'dir', has_children: true },
		themes: { id: 'themes', type: 'dir', has_children: true },
		uploads: { id: 'uploads', type: 'dir', has_children: true },
		'mu-plugins': { id: 'mu-plugins', type: 'dir', has_children: true },
	};
}
