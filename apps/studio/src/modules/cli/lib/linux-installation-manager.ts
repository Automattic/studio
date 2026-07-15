import {
	runCliAutoInstall,
	UnixCliInstallationManager,
} from 'src/modules/cli/lib/unix-installation-manager';

// Production install path for the Studio DEB package. Used in development mode to detect
// whether a production CLI is already installed alongside the running dev build.
const PROD_CLI_PACKAGED_PATH = '/usr/lib/studio/resources/bin/studio-cli.sh';

export function createLinuxCliInstallationManager(): UnixCliInstallationManager {
	return new UnixCliInstallationManager( {
		platform: 'linux',
		shellProfiles: { bash: '.bashrc', zsh: '.zshrc' },
		defaultProfile: '.bashrc',
		prodCliPackagedPath: PROD_CLI_PACKAGED_PATH,
	} );
}

export async function autoInstallLinuxCliIfNeeded(): Promise< void > {
	await runCliAutoInstall(
		'Linux',
		process.platform === 'linux' && process.env.NODE_ENV === 'production' && ! process.env.E2E,
		createLinuxCliInstallationManager
	);
}
