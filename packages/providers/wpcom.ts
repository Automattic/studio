// WordPress.com is the Studio sign-in, and its sites sync with local ones.
export { getSignInUrl, type SignInUrlOptions } from './wpcom/descriptor';
export {
	syncOptionSchema,
	syncSiteSchema,
	syncSupportValues,
	withWpcomDetails,
	type PullSyncOptions,
	type PushSyncOptions,
	type SyncOption,
	type SyncSite,
	type SyncSupport,
} from './wpcom/sites/site';
