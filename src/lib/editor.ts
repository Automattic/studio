export type SupportedEditor =
	| 'vscode'
	| 'phpstorm'
	| 'cursor'
	| 'windsurf'
	| 'nova'
	| 'webstorm'
	| 'sublime'
	| 'atom';

export const supportedEditorNames: Record< SupportedEditor, string > = {
	vscode: 'Visual Studio Code',
	phpstorm: 'PhpStorm',
	cursor: 'Cursor',
	windsurf: 'Windsurf',
	nova: 'Nova',
	webstorm: 'WebStorm',
	sublime: 'Sublime',
	atom: 'Atom',
};
