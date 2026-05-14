import { __, sprintf } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	DOLLY_AGENT_ID,
	DOLLY_AGENT_URL_ORIGIN,
	DOLLY_FRONTEND_ABILITIES,
	DOLLY_HISTORY_CLIENT,
	DOLLY_PREVIEW_TOOL_ID,
	DOLLY_REFRESH_PREVIEW_TOOL_ID,
	type DollyPreviewAbilityContext,
	type DollyPreviewContext,
	type DollyPreviewState,
	type DollySiteAssociationContext,
} from 'src/modules/wpcom-site-assistant/lib/types';
import { hasHttpProtocol, normalizeSiteBaseUrl } from 'src/modules/wpcom-site-assistant/lib/utils';
import type { Ability, ContextProvider } from '@automattic/agenttic-client';
import type { SyncSite } from '@studio/common/types/sync';

export const getStringValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): string | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'string' && value.trim() ) {
			return value.trim();
		}
	}
};

export const getBooleanValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): boolean | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'boolean' ) {
			return value;
		}
		if ( typeof value === 'string' ) {
			const normalizedValue = value.trim().toLowerCase();
			if ( normalizedValue === 'true' ) {
				return true;
			}
			if ( normalizedValue === 'false' ) {
				return false;
			}
		}
	}
};

export const shouldForcePreviewReload = ( toolArguments: Record< string, unknown > ): boolean =>
	getBooleanValue( toolArguments, [
		'siteChanged',
		'site_changed',
		'previewNeedsRefresh',
		'preview_needs_refresh',
	] ) === true;

export const createDollyPreviewAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: DOLLY_PREVIEW_TOOL_ID,
	label: 'Preview URL',
	description:
		'Open a web URL in the WordPress Studio side preview panel. Replaces any preview that is already open, but does not reload the current URL unless siteChanged is true.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'The absolute http or https URL to preview. Studio also accepts paths relative to the selected WordPress.com site, such as / or /wp-admin/.',
			},
			title: {
				type: 'string',
				description: 'Optional short title to show in the preview header.',
			},
			siteChanged: {
				type: 'boolean',
				description:
					'Set true only after changing the selected WordPress.com site so Studio refreshes the current preview.',
			},
		},
		required: [ 'url' ],
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			url: { type: 'string' },
			message: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use when the user asks to open, show, inspect, preview, or keep a URL visible beside the chat. Set siteChanged=true only when a preceding action changed site content, settings, theme, plugins, or other visible state that should be reloaded.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

export const createDollyRefreshPreviewAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: DOLLY_REFRESH_PREVIEW_TOOL_ID,
	label: 'Refresh Preview',
	description:
		'Refresh the currently open WordPress Studio side preview panel after the selected WordPress.com site has changed. Does not open the preview when it is hidden.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'Optional absolute http or https URL, or path relative to the selected WordPress.com site. When omitted, Studio refreshes the currently open preview URL.',
			},
			title: {
				type: 'string',
				description: 'Optional short title to show in the preview header.',
			},
			reason: {
				type: 'string',
				description: 'Short reason the preview needs to refresh.',
			},
		},
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			refreshed: { type: 'boolean' },
			url: { type: 'string' },
			message: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use immediately after successfully changing visible site content, pages, posts, navigation, templates, theme, plugins, settings, or other selected-site state when clientContext.preview.isOpen is true. Call before the final user-facing reply so the open preview reflects the change. Do not call for read-only lookups or when the preview is hidden.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

export const createDollyPreviewAbilities = ( {
	activeWpcomSite,
	previewState,
	openPreview,
}: DollyPreviewAbilityContext ): Ability[] => [
	createDollyPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		if ( ! requestedUrl ) {
			return {
				success: false,
				error: 'Preview needs a valid URL or WordPress.com site path.',
			};
		}

		const title = getStringValue( input, [ 'title', 'name' ] );
		const normalizedUrl = normalizePreviewUrl( activeWpcomSite.url, requestedUrl );
		openPreview( requestedUrl, title, {
			forceReload: shouldForcePreviewReload( input ),
		} );
		const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;

		return {
			success: true,
			url: normalizedUrl,
			message: sprintf( __( 'Opened preview: %s' ), displayTitle ),
		};
	} ),
	createDollyRefreshPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		const title = getStringValue( input, [ 'title', 'name' ] ) ?? previewState.title;
		const refreshUrl = requestedUrl || previewState.currentUrl || previewState.pathOrUrl || '/';
		const normalizedUrl = normalizePreviewUrl( activeWpcomSite.url, refreshUrl );

		if ( ! previewState.open ) {
			return {
				success: true,
				refreshed: false,
				url: normalizedUrl,
				message: __( 'Preview is hidden, so there was nothing to refresh.' ),
			};
		}

		openPreview( refreshUrl, title, {
			forceReload: true,
		} );
		const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;

		return {
			success: true,
			refreshed: true,
			url: normalizedUrl,
			message: sprintf( __( 'Refreshed preview: %s' ), displayTitle ),
		};
	} ),
];

export const createDollyClientContext = (
	siteId: number,
	selectedSite: SyncSite,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
) => ( {
	constructorArguments: {
		client: DOLLY_HISTORY_CLIENT,
	},
	selectedSiteId: siteId,
	preview: previewContext,
	studioSiteAssociation: siteAssociation,
	frontendAbilities: DOLLY_FRONTEND_ABILITIES,
	wpworkspace: {
		appName: window.appGlobals?.appName ?? 'WordPress Studio',
		currentActivity: 'Working on a WordPress.com site selected from Studio',
		clientVersion: window.appGlobals?.appVersion,
		preview: previewContext,
		studioSiteAssociation: siteAssociation,
		frontendAbilities: DOLLY_FRONTEND_ABILITIES,
		previewRefreshPolicy: {
			afterVisibleSiteChange:
				'When a successful action changes the selected site and preview.isOpen is true, call wpworkspace/refresh_preview before the final reply.',
			hiddenPreviewBehavior:
				'Do not open a hidden preview just to auto-refresh. Use wpworkspace/preview only when the user asks to open or show a preview.',
		},
		selectedSite: {
			id: selectedSite.id,
			name: selectedSite.name,
			url: selectedSite.url,
			siteId,
			kind: 'wpcom-site',
		},
	},
} );

export const createDollyContextProvider = (
	siteId: number,
	selectedSite: SyncSite,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
): ContextProvider => ( {
	getClientContext: () =>
		createDollyClientContext( siteId, selectedSite, previewContext, siteAssociation ),
} );

export const createDollyAuthProvider = () => async (): Promise< Record< string, string > > => {
	const token = await getIpcApi().getAuthenticationToken();
	return token?.accessToken ? { Authorization: `Bearer ${ token.accessToken }` } : {};
};

export const createDollyAgentUrl = ( siteId: number ) =>
	`${ DOLLY_AGENT_URL_ORIGIN }/sites/${ siteId }/ai/agent`;

export const createDollyAgentManagerKey = ( siteId: number ) =>
	`${ DOLLY_AGENT_ID }:wpcom-site:${ siteId }`;

export const isHttpUrl = ( value: string ) => {
	try {
		const url = new URL( value );
		return hasHttpProtocol( url );
	} catch {
		return false;
	}
};

export const normalizePreviewUrl = (
	baseUrl: string,
	rawValue: string,
	{ autoLoginSameOrigin = false }: { autoLoginSameOrigin?: boolean } = {}
) => {
	const trimmedValue = rawValue.trim();
	const normalizedBaseUrl = normalizeSiteBaseUrl( baseUrl );
	let targetUrl: URL;

	if ( isHttpUrl( trimmedValue ) ) {
		targetUrl = new URL( trimmedValue );
	} else if ( trimmedValue.includes( '.' ) && ! trimmedValue.startsWith( '/' ) ) {
		const normalizedRawUrl = normalizeSiteBaseUrl( trimmedValue );
		if ( ! normalizedRawUrl ) {
			return 'about:blank';
		}
		targetUrl = new URL( normalizedRawUrl );
	} else if ( normalizedBaseUrl ) {
		targetUrl = new URL( trimmedValue || '/', normalizedBaseUrl );
	} else {
		return 'about:blank';
	}

	if ( ! normalizedBaseUrl ) {
		return targetUrl.toString();
	}

	const siteOrigin = new URL( normalizedBaseUrl ).origin;
	if ( targetUrl.origin !== siteOrigin || ! autoLoginSameOrigin ) {
		return targetUrl.toString();
	}
	if ( targetUrl.pathname === '/studio-auto-login' ) {
		return targetUrl.toString();
	}

	const autoLoginUrl = new URL( '/studio-auto-login', normalizedBaseUrl );
	autoLoginUrl.searchParams.set( 'redirect_to', targetUrl.toString() );
	return autoLoginUrl.toString();
};

export const createPreviewContext = (
	selectedSite: SyncSite,
	previewState: DollyPreviewState,
	previewUrl?: string
): DollyPreviewContext => ( {
	isOpen: previewState.open,
	siteId: selectedSite.id,
	openedURL: previewUrl,
	currentURL: previewState.currentUrl ?? previewUrl,
	title: previewState.pageTitle ?? previewState.title,
	isLoading: previewState.isLoading,
} );

export const createWpcomOnlySiteAssociationContext = (
	selectedWpcomSite: SyncSite
): DollySiteAssociationContext => ( {
	status: 'wpcom_only',
	wpcomSiteId: selectedWpcomSite.id,
	wpcomSiteUrl: selectedWpcomSite.url,
	instructions:
		'This is a WordPress.com site selected from Studio that is not connected to a local Studio site. Dolly may manage this WordPress.com site. Studio local site controls, sync tabs, and local filesystem actions do not apply to this selection.',
} );

export const initialPreviewState = (): DollyPreviewState => ( {
	open: false,
	pathOrUrl: '/',
	isLoading: false,
	reloadNonce: 0,
} );
