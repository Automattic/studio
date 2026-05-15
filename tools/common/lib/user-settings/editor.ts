import { __ } from '@wordpress/i18n';

export const SUPPORTED_EDITORS = [
	'antigravity',
	'cursor',
	'vscode',
	'phpstorm',
	'windsurf',
	'webstorm',
	'sublime',
	'zed',
] as const;
export type SupportedEditor = ( typeof SUPPORTED_EDITORS )[ number ];

export type SupportedEditorConfig = {
	label: string;
	url: ( path: string ) => string;
	macOSBundleId: string;
	winPaths: string[];
	linuxCommands: string[];
};

export const supportedEditorConfig: Record< SupportedEditor, SupportedEditorConfig > = {
	antigravity: {
		// translators: "Antigravity" is the brand name for an IDE and does not need to be translated
		label: __( 'Antigravity' ),
		url: ( path: string ) => `antigravity://file/${ path }?windowId=_blank`,
		macOSBundleId: 'com.google.antigravity',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe',
			'%PROGRAMFILES%\\Google\\Antigravity\\Antigravity.exe',
		],
		linuxCommands: [ 'antigravity' ],
	},
	vscode: {
		// translators: "Visual Studio Code" is the brand name for an IDE and does not need to be translated
		label: __( 'Visual Studio Code' ),
		url: ( path: string ) => `vscode://file/${ path }?windowId=_blank`,
		macOSBundleId: 'com.microsoft.VSCode',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\code.exe',
			'%PROGRAMFILES%\\Microsoft VS Code\\code.exe',
			'%PROGRAMFILES(X86)%\\Microsoft VS Code\\code.exe',
		],
		linuxCommands: [ 'code' ],
	},
	phpstorm: {
		// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'PhpStorm' ),
		url: ( path: string ) => `phpstorm://open?file=${ path }`,
		macOSBundleId: 'com.jetbrains.PhpStorm',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\PhpStorm\\bin\\phpstorm64.exe',
			'%PROGRAMFILES%\\JetBrains\\PhpStorm*\\bin\\phpstorm64.exe',
		],
		linuxCommands: [ 'phpstorm' ],
	},
	webstorm: {
		// translators: "WebStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'WebStorm' ),
		url: ( path: string ) => `webstorm://open?file=${ path }`,
		macOSBundleId: 'com.jetbrains.WebStorm',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\WebStorm\\bin\\webstorm64.exe',
			'%PROGRAMFILES%\\JetBrains\\WebStorm*\\bin\\webstorm64.exe',
		],
		linuxCommands: [ 'webstorm' ],
	},
	windsurf: {
		// translators: "Windsurf" is the brand name for an IDE and does not need to be translated
		label: __( 'Windsurf' ),
		url: ( path: string ) => `windsurf://file/${ path }?windowId=_blank`,
		macOSBundleId: 'com.exafunction.windsurf',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe',
			'%PROGRAMFILES%\\Windsurf\\Windsurf.exe',
		],
		linuxCommands: [ 'windsurf' ],
	},
	cursor: {
		// translators: "Cursor" is the brand name for an IDE and does not need to be translated
		label: __( 'Cursor' ),
		url: ( path: string ) => `cursor://file/${ path }?windowId=_blank`,
		macOSBundleId: 'com.todesktop.230313mzl4w4u92',
		winPaths: [
			'%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe',
			'%PROGRAMFILES%\\cursor\\Cursor.exe',
		],
		linuxCommands: [ 'cursor' ],
	},
	sublime: {
		// translators: "Sublime Text" is the brand name for an IDE and does not need to be translated
		label: __( 'Sublime Text' ),
		url: ( path: string ) => `subl://open?url=file://${ path }`,
		macOSBundleId: 'com.sublimetext.4',
		winPaths: [
			'%PROGRAMFILES%\\Sublime Text\\sublime_text.exe',
			'%PROGRAMFILES%\\Sublime Text 4\\sublime_text.exe',
			'%PROGRAMFILES%\\Sublime Text 3\\sublime_text.exe',
		],
		linuxCommands: [ 'subl' ],
	},
	zed: {
		// translators: "Zed" is the brand name for an IDE and does not need to be translated
		label: __( 'Zed' ),
		url: ( path: string ) => `zed://file/${ path }`,
		macOSBundleId: 'dev.zed.Zed',
		winPaths: [ '%LOCALAPPDATA%\\Programs\\Zed\\zed.exe' ],
		linuxCommands: [ 'zed' ],
	},
};
