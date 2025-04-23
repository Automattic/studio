export type SupportedEditor = 'vscode' | 'phpstorm' | 'cursor' | 'windsurf' | 'webstorm';

export type SupportedEditorConfig = {
	label: string;
	url: ( path: string ) => string;
};

export const supportedEditorNames: Record< SupportedEditor, string > = {
	vscode: 'Visual Studio Code',
	phpstorm: 'PhpStorm',
	cursor: 'Cursor',
	windsurf: 'Windsurf',
	webstorm: 'WebStorm',
};

export const supportedEditorConfig: Record< SupportedEditor, SupportedEditorConfig > = {
	vscode: {
		label: 'VS Code',
		url: ( path: string ) => `vscode://file/${ path }?windowId=_blank`,
	},
	phpstorm: {
		label: 'PhpStorm',
		url: ( path: string ) => `phpstorm://open?file=${ path }`,
	},
	webstorm: {
		label: 'WebStorm',
		url: ( path: string ) => `webstorm://open?file=${ path }`,
	},
	windsurf: {
		label: 'WindSurf',
		url: ( path: string ) => `windsurf://file/${ path }?windowId=_blank`,
	},
	cursor: {
		label: 'Cursor',
		url: ( path: string ) => `cursor://file/${ path }?windowId=_blank`,
	},
};
