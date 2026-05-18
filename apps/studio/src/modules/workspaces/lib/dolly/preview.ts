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
import type { WorkspacePreviewState } from 'src/modules/workspaces/components/workspace-preview';
import type {
	RemoteTarget,
	StudioWorkspace,
	WorkspaceTargetId,
} from 'src/modules/workspaces/types';

type OpenPreviewOptions = {
	forceReload?: boolean;
};

type PreviewAbilityContext = {
	targets: PreviewAbilityTarget[];
	previewState: WorkspacePreviewState;
	openPreview: (
		targetId: WorkspaceTargetId,
		pathOrUrl?: string,
		options?: OpenPreviewOptions
	) => void;
};

export type PreviewAbilityTarget = {
	targetId: WorkspaceTargetId;
	siteId?: number | string;
	siteName: string;
	siteUrl: string;
	isProduction?: boolean;
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

const getTargetIdValue = ( record: Record< string, unknown > ): WorkspaceTargetId | undefined => {
	const targetId = getStringValue( record, [ 'targetId', 'target_id', 'target' ] );
	if ( targetId === 'local' || targetId === 'staging' || targetId === 'production' ) {
		return targetId;
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
		'Open a web URL in the WordPress Studio side preview panel for an explicit workspace target.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			targetId: {
				type: 'string',
				enum: [ 'local', 'staging', 'production' ],
				description:
					'Required workspace target to preview. Use local when available for safest read-only inspection, staging before production for remote previews.',
			},
			url: {
				type: 'string',
				description:
					'The absolute http or https URL to preview. Studio also accepts paths relative to the requested workspace target, such as / or /wp-admin/.',
			},
			siteChanged: {
				type: 'boolean',
				description:
					'Set true only after changing the selected WordPress.com site so Studio refreshes the current preview.',
			},
		},
		required: [ 'targetId', 'url' ],
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
		'Refresh the currently open WordPress Studio side preview panel after an explicit workspace target has changed.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			targetId: {
				type: 'string',
				enum: [ 'local', 'staging', 'production' ],
				description:
					'Required workspace target to refresh. Production should only be used after explicit user confirmation for production-impacting changes.',
			},
			url: {
				type: 'string',
				description:
					'Optional absolute http or https URL, or path relative to the requested workspace target.',
			},
			reason: {
				type: 'string',
				description: 'Short reason the preview needs to refresh.',
			},
		},
		required: [ 'targetId' ],
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
	targets,
	previewState,
	openPreview,
}: PreviewAbilityContext ): Ability[] => [
	createWorkspaceDollyPreviewAbility( ( input: Record< string, unknown > ) => {
		const targetId = getTargetIdValue( input );
		const target = targets.find( ( candidate ) => candidate.targetId === targetId );
		if ( ! target ) {
			return {
				success: false,
				error: 'Preview needs a valid targetId: local, staging, or production.',
			};
		}

		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		if ( ! requestedUrl ) {
			return {
				success: false,
				error: 'Preview needs a valid URL or workspace target path.',
			};
		}

		const normalizedUrl = normalizeWorkspaceDollyPreviewUrl( target.siteUrl, requestedUrl );
		openPreview( target.targetId, requestedUrl, {
			forceReload: shouldForcePreviewReload( input ),
		} );

		return {
			success: true,
			url: normalizedUrl,
			message: sprintf( __( 'Opened preview: %s' ), normalizedUrl ),
		};
	} ),
	createWorkspaceDollyRefreshPreviewAbility( ( input: Record< string, unknown > ) => {
		const targetId = getTargetIdValue( input );
		const target = targets.find( ( candidate ) => candidate.targetId === targetId );
		if ( ! target ) {
			return {
				success: false,
				refreshed: false,
				error: 'Refresh preview needs a valid targetId: local, staging, or production.',
			};
		}

		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		const refreshUrl = requestedUrl || previewState.currentUrl || previewState.pathOrUrl || '/';
		const normalizedUrl = normalizeWorkspaceDollyPreviewUrl( target.siteUrl, refreshUrl );

		if ( ! previewState.open ) {
			return {
				success: true,
				refreshed: false,
				url: normalizedUrl,
				message: __( 'Preview is hidden, so there was nothing to refresh.' ),
			};
		}

		openPreview( target.targetId, refreshUrl, { forceReload: true } );

		return {
			success: true,
			refreshed: true,
			url: normalizedUrl,
			message: sprintf( __( 'Refreshed preview: %s' ), normalizedUrl ),
		};
	} ),
];

export const createWorkspaceDollyPreviewContext = (
	targetId: WorkspaceTargetId | undefined,
	siteUrl: string,
	previewState: WorkspacePreviewState,
	siteId?: number | string
): WorkspaceDollyPreviewContext => {
	const openedURL = resolveWorkspacePreviewUrl( siteUrl, previewState.pathOrUrl );

	return {
		isOpen: previewState.open,
		targetId,
		siteId,
		openedURL,
		currentURL: previewState.currentUrl ?? openedURL,
		isLoading: false,
	};
};

export const createWorkspaceDollySiteAssociationContext = ( {
	workspaceId,
	workspace,
	transportTarget,
	activeTarget,
	activeUrl,
	targets,
}: {
	workspaceId: string;
	workspace: StudioWorkspace;
	transportTarget: RemoteTarget;
	activeTarget?: PreviewAbilityTarget;
	activeUrl?: string;
	targets: PreviewAbilityTarget[];
} ): WorkspaceDollySiteAssociationContext => ( {
	status: 'workspace',
	workspaceId,
	transportTargetId: transportTarget.id,
	transportWpcomSiteId: transportTarget.site.id,
	transportWpcomSiteUrl: transportTarget.site.url,
	activeTargetId: activeTarget?.targetId,
	activeSiteId: activeTarget?.siteId,
	activeSiteUrl: activeUrl ?? activeTarget?.siteUrl,
	activeSiteBaseUrl: activeTarget?.siteUrl,
	targets: targets.map( ( target ) => ( {
		targetId: target.targetId,
		siteId: target.siteId,
		siteUrl: target.siteUrl,
		isProduction: target.targetId === 'production',
	} ) ),
	instructions: `This WordPress Studio workspace is "${ workspace.name }". Local, staging, and production are capabilities inside the workspace, not separate chats. Every target-specific action must choose an explicit targetId. Ask when a requested change is ambiguous. Prefer local, then staging, then production for safe read-only defaults. Production-impacting actions require clear user confirmation before acting.`,
} );

export const createWorkspaceDollyClientContext = (
	workspaceId: string,
	workspace: StudioWorkspace,
	transportTarget: RemoteTarget,
	previewContext: WorkspaceDollyPreviewContext,
	siteAssociation: WorkspaceDollySiteAssociationContext,
	targets: PreviewAbilityTarget[]
) => {
	const activeTarget = targets.find( ( target ) => target.targetId === previewContext.targetId );
	const activeTargetUrl = siteAssociation.activeSiteUrl ?? activeTarget?.siteUrl;

	return {
		constructorArguments: {
			client: WORKSPACE_DOLLY_HISTORY_CLIENT,
		},
		selectedSiteId: transportTarget.site.id,
		preview: previewContext,
		studioSiteAssociation: siteAssociation,
		frontendAbilities: WORKSPACE_DOLLY_FRONTEND_ABILITIES,
		wpworkspace: {
			appName: window.appGlobals?.appName ?? 'WordPress Studio',
			currentActivity:
				'Working in one WordPress Studio workspace. Targets are explicit tool contexts, not separate chats.',
			clientVersion: window.appGlobals?.appVersion,
			workspace: {
				id: workspaceId,
				name: workspace.name,
				activeTarget: activeTarget
					? {
							targetId: activeTarget.targetId,
							siteId: activeTarget.siteId,
							name: activeTarget.siteName,
							url: activeTargetUrl,
							siteUrl: activeTarget.siteUrl,
							currentUrl: previewContext.currentURL ?? activeTargetUrl,
							isProduction: activeTarget.targetId === 'production',
					  }
					: undefined,
				targets: targets.map( ( target ) => ( {
					targetId: target.targetId,
					siteId: target.siteId,
					name: target.siteName,
					url: target.siteUrl,
					isProduction: target.targetId === 'production',
				} ) ),
			},
			selectedSite: {
				id: transportTarget.site.id,
				name: transportTarget.site.name,
				url: transportTarget.site.url,
				siteId: transportTarget.site.id,
				kind: 'wpcom-site',
				transportTargetId: transportTarget.id,
			},
			preview: previewContext,
			studioSiteAssociation: siteAssociation,
			frontendAbilities: WORKSPACE_DOLLY_FRONTEND_ABILITIES,
			targetPolicy: {
				required:
					'Every tool call that reads, previews, syncs, or mutates a site must include an explicit targetId.',
				ambiguousChanges:
					'Ask the user which target to change unless the safest target is clearly local or staging.',
				production:
					'Production-impacting actions require clear confirmation and should be called out visibly.',
			},
			previewRefreshPolicy: {
				afterVisibleSiteChange:
					'When a successful action changes a visible target and preview.isOpen is true, call wpworkspace/refresh_preview with that explicit targetId before the final reply.',
				hiddenPreviewBehavior:
					'Do not open a hidden preview just to auto-refresh. Use wpworkspace/preview only when the user asks to open or show a preview.',
			},
		},
	};
};

export const createWorkspaceDollyContextProvider = (
	workspaceId: string,
	workspace: StudioWorkspace,
	transportTarget: RemoteTarget,
	previewContext: WorkspaceDollyPreviewContext,
	siteAssociation: WorkspaceDollySiteAssociationContext,
	targets: PreviewAbilityTarget[]
): ContextProvider => ( {
	getClientContext: () =>
		createWorkspaceDollyClientContext(
			workspaceId,
			workspace,
			transportTarget,
			previewContext,
			siteAssociation,
			targets
		),
} );

export const createWorkspaceDollyAuthProvider =
	() => async (): Promise< Record< string, string > > => {
		const token = await getIpcApi().getAuthenticationToken();
		return token?.accessToken ? { Authorization: `Bearer ${ token.accessToken }` } : {};
	};

export const createWorkspaceDollyAgentUrl = ( siteId: number ) =>
	`${ WORKSPACE_DOLLY_AGENT_URL_ORIGIN }/sites/${ siteId }/ai/agent`;

export const createWorkspaceDollyAgentManagerKey = ( workspaceId: string, siteId: number ) =>
	`${ workspaceId }:${ siteId }:${ WORKSPACE_DOLLY_HISTORY_CLIENT }`;

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
