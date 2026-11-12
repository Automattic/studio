export {
	syncOptionSchema,
	syncSiteSchema,
	syncSupportValues,
	type PullSyncOptions,
	type PushSyncOptions,
	type SyncOption,
	type SyncSite,
	type SyncSupport,
} from '@studio/providers';

// Phases a push moves through: Studio builds the archive, then the provider
// takes over (`PushStatus`).
export const PUSH_PHASES = [
	'creatingBackup',
	'uploading',
	'creatingRemoteBackup',
	'applyingChanges',
	'finishing',
	'launching',
] as const;
export type PushPhase = ( typeof PUSH_PHASES )[ number ];
