import { __ } from '@wordpress/i18n';

export type SupportedEditor = 'vscode' | 'phpstorm' | 'cursor' | 'windsurf' | 'webstorm';

export type SupportedEditorConfig = {
	label: string;
	url: ( path: string ) => string;
	bundleId: string;
	winCommand: string;
};

export const supportedEditorConfig: Record< SupportedEditor, SupportedEditorConfig > = {
	vscode: {
		// translators: "VS Code" is the brand name for an IDE and does not need to be translated
		label: __( 'VS Code' ),
		url: ( path: string ) => `vscode://file/${ path }?windowId=_blank`,
		bundleId: 'com.microsoft.VSCode',
		winCommand: 'code',
	},
	phpstorm: {
		// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'PhpStorm' ),
		url: ( path: string ) => `phpstorm://open?file=${ path }`,
		bundleId: 'com.jetbrains.PhpStorm',
		winCommand: 'phpstorm64.exe',
	},
	webstorm: {
		// translators: "WebStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'WebStorm' ),
		url: ( path: string ) => `webstorm://open?file=${ path }`,
		bundleId: 'com.jetbrains.WebStorm',
		winCommand: 'webstorm64.exe',
	},
	windsurf: {
		// translators: "Windsurf" is the brand name for an IDE and does not need to be translated
		label: __( 'Windsurf' ),
		url: ( path: string ) => `windsurf://file/${ path }?windowId=_blank`,
		bundleId: 'com.exafunction.windsurf',
		winCommand: 'windsurf.exe',
	},
	cursor: {
		// translators: "Cursor" is the brand name for an IDE and does not need to be translated
		label: __( 'Cursor' ),
		url: ( path: string ) => `cursor://file/${ path }?windowId=_blank`,
		bundleId: 'com.todesktop.230313mzl4w4u92',
		winCommand: 'cursor.exe',
	},
};
