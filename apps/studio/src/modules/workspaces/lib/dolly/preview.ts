import { __, sprintf } from '@wordpress/i18n';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { resolveWorkspacePreviewUrl } from 'src/modules/workspaces/components/workspace-preview';
import {
	WORKSPACE_DOLLY_AGENT_URL_ORIGIN,
	WORKSPACE_DOLLY_FRONTEND_ABILITIES,
	WORKSPACE_DOLLY_HISTORY_CLIENT,
	WORKSPACE_DOLLY_PREVIEW_TOOL_ID,
	WORKSPACE_DOLLY_REFRESH_PREVIEW_TOOL_ID,
	type WorkspaceDollyPreviewContext,
	type WorkspaceDollySiteAssociationContext,
} from 'src/modules/workspaces/lib/dolly/types';
import { hasHttpProtocol } from 'src/modules/workspaces/lib/dolly/utils';
import type { Ability, ContextProvider } from '@automattic/agenttic-client';
import type { SyncSite } from '@studio/common/types/sync';
import type { WorkspacePreviewState } from 'src/modules/workspaces/components/workspace-preview';
import type { RemoteTargetId } from 'src/modules/workspaces/types';

type OpenPreviewOptions = {
	forceReload?: boolean;
};

type PreviewAbilityContext = {
	site: SyncSite;
	previewState: WorkspacePreviewState;
	openPreview: ( pathOrUrl?: string, options?: OpenPreviewOptions ) => void;
};

const getStringValue = (
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

const getBooleanValue = (
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

const shouldForcePreviewReload = ( toolArguments: Record< string, unknown > ): boolean =>
	getBooleanValue( toolArguments, [
		'siteChanged',
		'site_changed',
		'previewNeedsRefresh',
		'preview_needs_refresh',
	] ) === true;

export const getNextWorkspaceDollyPreviewState = (
	currentState: WorkspacePreviewState,
	pathOrUrl = '/',
	{ forceReload = false }: OpenPreviewOptions = {}
): WorkspacePreviewState => {
	const shouldLoad = forceReload || ! currentState.open || currentState.pathOrUrl !== pathOrUrl;

	return {
		...currentState,
		open: true,
		pathOrUrl,
		currentUrl: shouldLoad ? undefined : currentState.currentUrl,
		canGoBack: shouldLoad ? false : currentState.canGoBack,
		canGoForward: shouldLoad ? false : currentState.canGoForward,
		reloadNonce: forceReload ? currentState.reloadNonce + 1 : currentState.reloadNonce,
		navigationAction: undefined,
	};
};

const createWorkspaceDollyPreviewAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: WORKSPACE_DOLLY_PREVIEW_TOOL_ID,
	label: 'Preview URL',
	description:
		'Open a web URL in the WordPress Studio side preview panel for the currently selected workspace target.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'The absolute http or https URL to preview. Studio also accepts paths relative to the selected WordPress.com site, such as / or /wp-admin/.',
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
				'Use when the user asks to open, show, inspect, preview, or keep a URL visible beside the chat.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

const createWorkspaceDollyRefreshPreviewAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: WORKSPACE_DOLLY_REFRESH_PREVIEW_TOOL_ID,
	label: 'Refresh Preview',
	description:
		'Refresh the currently open WordPress Studio side preview panel after the selected WordPress.com site has changed.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'Optional absolute http or https URL, or path relative to the selected WordPress.com site.',
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
				'Use immediately after successfully changing visible site content when clientContext.preview.isOpen is true.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

export const createWorkspaceDollyPreviewAbilities = ( {
	site,
	previewState,
	openPreview,
}: PreviewAbilityContext ): Ability[] => [
	createWorkspaceDollyPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		if ( ! requestedUrl ) {
			return {
				success: false,
				error: 'Preview needs a valid URL or WordPress.com site path.',
			};
		}

		const normalizedUrl = normalizeWorkspaceDollyPreviewUrl( site.url, requestedUrl );
		openPreview( requestedUrl, {
			forceReload: shouldForcePreviewReload( input ),
		} );

		return {
			success: true,
			url: normalizedUrl,
			message: sprintf( __( 'Opened preview: %s' ), normalizedUrl ),
		};
	} ),
	createWorkspaceDollyRefreshPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		const refreshUrl = requestedUrl || previewState.currentUrl || previewState.pathOrUrl || '/';
		const normalizedUrl = normalizeWorkspaceDollyPreviewUrl( site.url, refreshUrl );

		if ( ! previewState.open ) {
			return {
				success: true,
				refreshed: false,
				url: normalizedUrl,
				message: __( 'Preview is hidden, so there was nothing to refresh.' ),
			};
		}

		openPreview( refreshUrl, { forceReload: true } );

		return {
			success: true,
			refreshed: true,
			url: normalizedUrl,
			message: sprintf( __( 'Refreshed preview: %s' ), normalizedUrl ),
		};
	} ),
];

export const createWorkspaceDollyPreviewContext = (
	siteId: number,
	siteUrl: string,
	previewState: WorkspacePreviewState
): WorkspaceDollyPreviewContext => {
	const openedURL = resolveWorkspacePreviewUrl( siteUrl, previewState.pathOrUrl );

	return {
		isOpen: previewState.open,
		siteId,
		openedURL,
		currentURL: previewState.currentUrl ?? openedURL,
		isLoading: false,
	};
};

export const createWorkspaceDollySiteAssociationContext = ( {
	workspaceId,
	targetId,
	site,
}: {
	workspaceId: string;
	targetId: RemoteTargetId;
	site: SyncSite;
} ): WorkspaceDollySiteAssociationContext => ( {
	status: 'workspace_target',
	workspaceId,
	targetId,
	wpcomSiteId: site.id,
	wpcomSiteUrl: site.url,
	instructions:
		'This WordPress.com site is the selected target in WordPress Studio. Keep all actions scoped to this selected workspace target unless the user explicitly switches targets.',
} );

export const createWorkspaceDollyClientContext = (
	workspaceId: string,
	targetId: RemoteTargetId,
	site: SyncSite,
	previewContext: WorkspaceDollyPreviewContext,
	siteAssociation: WorkspaceDollySiteAssociationContext
) => ( {
	constructorArguments: {
		client: WORKSPACE_DOLLY_HISTORY_CLIENT,
	},
	selectedSiteId: site.id,
	preview: previewContext,
	studioSiteAssociation: siteAssociation,
	frontendAbilities: WORKSPACE_DOLLY_FRONTEND_ABILITIES,
	wpworkspace: {
		appName: window.appGlobals?.appName ?? 'WordPress Studio',
		currentActivity: 'Working on a WordPress.com workspace target selected from Studio',
		clientVersion: window.appGlobals?.appVersion,
		workspace: {
			id: workspaceId,
			targetId,
		},
		selectedSite: {
			id: site.id,
			name: site.name,
			url: site.url,
			siteId: site.id,
			kind: 'wpcom-site',
		},
		preview: previewContext,
		studioSiteAssociation: siteAssociation,
		frontendAbilities: WORKSPACE_DOLLY_FRONTEND_ABILITIES,
		previewRefreshPolicy: {
			afterVisibleSiteChange:
				'When a successful action changes the selected site and preview.isOpen is true, call wpworkspace/refresh_preview before the final reply.',
			hiddenPreviewBehavior:
				'Do not open a hidden preview just to auto-refresh. Use wpworkspace/preview only when the user asks to open or show a preview.',
		},
	},
} );

export const createWorkspaceDollyContextProvider = (
	workspaceId: string,
	targetId: RemoteTargetId,
	site: SyncSite,
	previewContext: WorkspaceDollyPreviewContext,
	siteAssociation: WorkspaceDollySiteAssociationContext
): ContextProvider => ( {
	getClientContext: () =>
		createWorkspaceDollyClientContext(
			workspaceId,
			targetId,
			site,
			previewContext,
			siteAssociation
		),
} );

export const createWorkspaceDollyAuthProvider =
	() => async (): Promise< Record< string, string > > => {
		const token = await getIpcApi().getAuthenticationToken();
		return token?.accessToken ? { Authorization: `Bearer ${ token.accessToken }` } : {};
	};

export const createWorkspaceDollyAgentUrl = ( siteId: number ) =>
	`${ WORKSPACE_DOLLY_AGENT_URL_ORIGIN }/sites/${ siteId }/ai/agent`;

export const createWorkspaceDollyAgentManagerKey = (
	workspaceId: string,
	targetId: RemoteTargetId,
	siteId: number
) => `${ workspaceId }:${ targetId }:${ siteId }:${ WORKSPACE_DOLLY_HISTORY_CLIENT }`;

const isHttpUrl = ( value: string ) => {
	try {
		const url = new URL( value );
		return hasHttpProtocol( url );
	} catch {
		return false;
	}
};

export const normalizeWorkspaceDollyPreviewUrl = ( baseUrl: string, rawValue: string ) => {
	const trimmedValue = rawValue.trim();

	if ( isHttpUrl( trimmedValue ) ) {
		return new URL( trimmedValue ).toString();
	}

	if ( trimmedValue.includes( '.' ) && ! trimmedValue.startsWith( '/' ) ) {
		try {
			return new URL( `https://${ trimmedValue }` ).toString();
		} catch {
			return 'about:blank';
		}
	}

	return resolveWorkspacePreviewUrl( baseUrl, trimmedValue || '/' );
};
