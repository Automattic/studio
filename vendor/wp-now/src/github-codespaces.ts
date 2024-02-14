/*
 * True if the current environment is a GitHub Codespace
 */
export const isGitHubCodespace = Boolean(
	process.env.CODESPACE_NAME &&
		process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
);

/*
 * Returns the URL in the current GitHub Codespace
 * e.g: https://sejas-fluffy-space-eureka-wrj7r95qhvq4x-8881.preview.app.github.dev
 */
export function getCodeSpaceURL(port: number): string {
	return `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
}
