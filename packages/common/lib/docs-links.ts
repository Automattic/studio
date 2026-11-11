import type { SupportedLocale } from '@studio/common/lib/locale';

type TranslatedLink = Partial< Record< SupportedLocale, string > > & { en: string };

const DOCS_LINKS = {
	docsCli: {
		en: 'https://wordpress.studio/docs/cli/',
	},
	docsMcp: {
		en: 'https://wordpress.studio/docs/mcp-on-studio/',
	},
	docsSites: {
		en: 'https://wordpress.studio/docs/sites/',
	},
	docsSslInStudio: {
		en: 'https://wordpress.studio/docs/ssl-in-studio/',
	},
	docsSkills: {
		en: 'https://wordpress.studio/docs/agent-skills-wordpress-studio/',
	},
	docsStudio: {
		en: 'https://wordpress.studio/docs/',
	},
	docsStudioCode: {
		en: 'https://wordpress.studio/docs/studio-code/',
	},
	docsAiCredits: {
		en: 'https://wordpress.studio/docs/studio-code/ai-credits-guidelines/',
	},
	docsAnthropicApiKey: {
		en: 'https://platform.claude.com/docs/en/get-api-key',
	},
	docsCustomDomains: {
		en: 'https://wordpress.studio/docs/sites/#using-a-custom-domain-and-ssl',
	},
	docsSiteSettings: {
		en: 'https://wordpress.studio/docs/sites/#site-settings',
	},
	docsFileAccess: {
		en: 'https://wordpress.studio/docs/php-runtimes/#file-access',
	},
	docsXdebug: {
		en: 'https://wordpress.studio/docs/xdebug/',
	},
	docsWpEnvironmentType: {
		en: 'https://developer.wordpress.org/reference/functions/wp_get_environment_type/',
	},
	docsScriptDebug: {
		en: 'https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#script_debug',
	},
	docsDebugDisplay: {
		en: 'https://developer.wordpress.org/advanced-administration/debug/debug-wordpress/#wp_debug_display',
	},
	docsSyncSupportedSites: {
		en: 'https://wordpress.studio/docs/sync/#compatible-sites',
	},
	a8cTos: {
		en: 'https://automattic.com/tos/',
	},
	a8cPrivacyPolicy: {
		en: 'https://automattic.com/privacy/',
	},
} as const satisfies Record< string, TranslatedLink >;

export const REPORT_ISSUE_URL = 'https://github.com/Automattic/studio/issues/new/choose';

export type DocsLinkKey = keyof typeof DOCS_LINKS;

export function getLocalizedLink( locale: SupportedLocale | undefined, key: DocsLinkKey ): string {
	const links = DOCS_LINKS[ key ];
	if ( locale && locale in links ) {
		return links[ locale as keyof typeof links ] ?? links.en;
	}
	return links.en;
}
