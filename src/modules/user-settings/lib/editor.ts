import { __ } from '@wordpress/i18n';

export type SupportedEditor = 'vscode' | 'phpstorm' | 'cursor' | 'windsurf' | 'webstorm';

export type SupportedEditorConfig = {
	label: string;
	url: ( path: string ) => string;
};

export const supportedEditorConfig: Record< SupportedEditor, SupportedEditorConfig > = {
	vscode: {
		// translators: "VS Code" is the brand name for an IDE and does not need to be translated
		label: __( 'VS Code' ),
		url: ( path: string ) => `vscode://file/${ path }?windowId=_blank`,
	},
	phpstorm: {
		// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'PhpStorm' ),
		url: ( path: string ) => `phpstorm://open?file=${ path }`,
	},
	webstorm: {
		// translators: "WebStorm" is the brand name for an IDE and does not need to be translated
		label: __( 'WebStorm' ),
		url: ( path: string ) => `webstorm://open?file=${ path }`,
	},
	windsurf: {
		// translators: "Windsurf" is the brand name for an IDE and does not need to be translated
		label: __( 'WindSurf' ),
		url: ( path: string ) => `windsurf://file/${ path }?windowId=_blank`,
	},
	cursor: {
		// translators: "Cursor" is the brand name for an IDE and does not need to be translated
		label: __( 'Cursor' ),
		url: ( path: string ) => `cursor://file/${ path }?windowId=_blank`,
	},
};
