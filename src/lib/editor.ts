export const DEFAULT_EDITOR = 'none';

export type SupportedEditor = 'vscode' | 'phpstorm' | 'none';

export const supportedEditorNames: Record< SupportedEditor, string > = {
	vscode: 'Visual Studio Code',
	phpstorm: 'PhpStorm',
	none: 'None',
};
