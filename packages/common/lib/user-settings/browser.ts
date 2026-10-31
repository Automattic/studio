export const SUPPORTED_BROWSERS = [
	'chrome',
	'safari',
	'firefox',
	'edge',
	'brave',
	'arc',
	'chromium',
] as const;
export type SupportedBrowser = ( typeof SUPPORTED_BROWSERS )[ number ];

export interface SystemBrowser {
	name: string;
	browser?: SupportedBrowser;
}

export const browserConfig: Record<
	SupportedBrowser,
	{
		name: string;
		macOSApp: string;
		winPath: string;
		linuxCommands: string[];
	}
> = {
	chrome: {
		name: 'Google Chrome',
		macOSApp: 'Google Chrome.app',
		winPath: 'Google/Chrome/Application/chrome.exe',
		linuxCommands: [ 'google-chrome', 'google-chrome-stable' ],
	},
	safari: {
		name: 'Safari',
		macOSApp: 'Safari.app',
		winPath: '',
		linuxCommands: [],
	},
	firefox: {
		name: 'Firefox',
		macOSApp: 'Firefox.app',
		winPath: 'Mozilla Firefox/firefox.exe',
		linuxCommands: [ 'firefox' ],
	},
	edge: {
		name: 'Microsoft Edge',
		macOSApp: 'Microsoft Edge.app',
		winPath: 'Microsoft/Edge/Application/msedge.exe',
		linuxCommands: [ 'microsoft-edge', 'microsoft-edge-stable' ],
	},
	brave: {
		name: 'Brave',
		macOSApp: 'Brave Browser.app',
		winPath: 'BraveSoftware/Brave-Browser/Application/brave.exe',
		linuxCommands: [ 'brave-browser', 'brave' ],
	},
	arc: {
		name: 'Arc',
		macOSApp: 'Arc.app',
		winPath: '',
		linuxCommands: [],
	},
	chromium: {
		name: 'Chromium',
		macOSApp: 'Chromium.app',
		winPath: 'Chromium/Application/chrome.exe',
		linuxCommands: [ 'chromium', 'chromium-browser' ],
	},
};
