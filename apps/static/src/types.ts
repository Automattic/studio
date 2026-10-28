import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { SiteFileAccess } from '@studio/common/lib/site-file-access';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

export type { ActiveAgentRun } from '@studio/agent/protocol/agent-events';
export type { StudioChatFileAttachment } from '@studio/agent/protocol/chat-files';
export type { StudioChatImage } from '@studio/agent/protocol/chat-images';
export type {
	AiSessionMetadata,
	AiSessionSummary,
	LoadedAiSession,
} from '@studio/agent/protocol/sessions/types';
export type { StudioVisualAnnotationSummary } from '@studio/agent/protocol/visual-annotations';
export type { SessionEntry } from '@earendil-works/pi-coding-agent';
export type { SnapshotUsage } from '@studio/common/lib/snapshots';
export type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
export type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
export type { Snapshot } from '@studio/common/types/snapshot';
export type { SyncSite } from '@studio/common/types/sync';

// A site as the UI lists it: the CLI's shape, with its place in the sidebar.
export type StaticSiteDetails = SiteListItem & { sortOrder?: number };

// What updating a site's settings changes.
export type StaticSiteSettings = Pick< StaticSiteDetails, 'id' | 'name' | 'phpVersion' > &
	Partial<
		Pick<
			StaticSiteDetails,
			| 'isWpAutoUpdating'
			| 'adminUsername'
			| 'adminPassword'
			| 'adminEmail'
			| 'enableDebugLog'
			| 'enableDebugDisplay'
			| 'enableScriptDebug'
			| 'environmentType'
		>
	>;

export interface AuthUser {
	id: number;
	email: string;
	displayName: string;
}

// What a new site is created with.
export interface CreateSiteParams {
	name: string;
	path: string;
	phpVersion?: string;
	fileAccess?: SiteFileAccess;
	wpVersion?: string;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	// Creates the site without starting it.
	skipStart?: boolean;
	blueprint?: { blueprint: BlueprintV1Declaration };
}

// A conversation that a site took over, such as one whose agent created it.
export interface AiSessionPlacementUpdatedEvent {
	sessionId: string;
	placement: { kind: 'site'; siteId: string; sitePath: string; siteName: string };
}
