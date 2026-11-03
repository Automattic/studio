export const SUPPORTED_BROWSERS = [
	'chrome',
	'safari',
	'firefox',
	'edge',
	'brave',
	'arc',
	'chromium',
	'opera',
	'vivaldi',
	'zen',
	'firefox-developer',
	'duckduckgo',
	'dia',
] as const;
export type SupportedBrowser = ( typeof SUPPORTED_BROWSERS )[ number ];

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
	opera: {
		name: 'Opera',
		macOSApp: 'Opera.app',
		winPath: 'Opera/launcher.exe',
		linuxCommands: [ 'opera', 'opera-stable' ],
	},
	vivaldi: {
		name: 'Vivaldi',
		macOSApp: 'Vivaldi.app',
		winPath: 'Vivaldi/Application/vivaldi.exe',
		linuxCommands: [ 'vivaldi', 'vivaldi-stable' ],
	},
	zen: {
		name: 'Zen',
		macOSApp: 'Zen.app',
		winPath: 'Zen Browser/zen.exe',
		linuxCommands: [ 'zen', 'zen-browser' ],
	},
	'firefox-developer': {
		name: 'Firefox Developer Edition',
		macOSApp: 'Firefox Developer Edition.app',
		winPath: 'Firefox Developer Edition/firefox.exe',
		linuxCommands: [ 'firefox-developer-edition', 'firefox-developer' ],
	},
	duckduckgo: {
		name: 'DuckDuckGo',
		macOSApp: 'DuckDuckGo.app',
		winPath: '',
		linuxCommands: [],
	},
	dia: {
		name: 'Dia',
		macOSApp: 'Dia.app',
		winPath: '',
		linuxCommands: [],
	},
};
