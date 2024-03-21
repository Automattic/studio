import fs from 'fs';

const macAppPaths: Record< keyof InstalledApps, string > = {
	vscode: '/Applications/Visual Studio Code.app',
	phpstorm: '/Applications/PhpStorm.app',
};

export function isInstalled( key: keyof typeof macAppPaths ): boolean {
	return fs.existsSync( macAppPaths[ key ] );
}
