// Installed-app detection now lives in @studio/common so the desktop app and
// the local web server (`studio ui`) share one implementation. This re-export
// keeps existing desktop imports — and the tests that mock this module — working.
export {
	detectInstalledApps,
	isInstalled,
	type AppKey,
	type InstalledApps,
} from '@studio/common/lib/user-settings/installed-apps';
