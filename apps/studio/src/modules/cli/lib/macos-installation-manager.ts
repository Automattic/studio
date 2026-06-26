import fs from 'node:fs';
import path from 'node:path';
import { sudoExec } from 'src/lib/sudo-exec';
import {
	runCliAutoInstall,
	UnixCliInstallationManager,
} from 'src/modules/cli/lib/cli-installation-manager-base';
import { getResourcesPath } from 'src/storage/paths';
import packageJson from '../../../../package.json';

const legacyCliSymlinkPath = '/usr/local/bin/studio';
const uninstallScriptPath = path.join( getResourcesPath(), 'bin', 'uninstall-studio-cli.sh' );

const prodCliPackagedPath = path.join(
	path.sep,
	'Applications',
	'Studio.app',
	'Contents',
	'Resources',
	'bin',
	'studio-cli.sh'
);

export class MacOSCliInstallationManager extends UnixCliInstallationManager {
	constructor() {
		super( {
			platform: 'darwin',
			shellProfiles: { bash: '.bash_profile', zsh: '.zshrc' },
			defaultProfile: '.zshrc',
			prodCliPackagedPath,
		} );
	}

	protected async onUninstalled(): Promise< void > {
		await this.uninstallLegacyCliIfNeeded();
	}

	private async uninstallLegacyCliIfNeeded(): Promise< void > {
		const legacyCliExists = await this.doesSymlinkLeadToPackagedCli( legacyCliSymlinkPath );
		if ( ! legacyCliExists ) {
			return;
		}

		try {
			await fs.promises.unlink( legacyCliSymlinkPath );
		} catch ( error ) {
			// `/usr/local/bin` is not typically writable by non-root users, so in most cases, we run
			// this uninstall script with admin privileges to remove the symlink.
			await sudoExec( `/bin/sh "${ uninstallScriptPath }"`, {
				name: packageJson.productName,
				env: {
					CLI_SYMLINK_PATH: legacyCliSymlinkPath,
				},
			} );
		}
	}
}

export async function autoInstallMacOSCliIfNeeded(): Promise< void > {
	await runCliAutoInstall(
		'macOS',
		process.platform === 'darwin' && process.env.NODE_ENV === 'production',
		() => new MacOSCliInstallationManager()
	);
}
