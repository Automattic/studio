/**
 * Sudo Execution Helper
 *
 * Checks if the process has elevated privileges and provides
 * helpers for executing commands with sudo.
 */

/**
 * Check if the current process is running with elevated privileges
 */
export function isRunningAsRoot(): boolean {
	// On Unix-like systems, check if UID is 0 (root)
	if ( process.platform !== 'win32' ) {
		return process.getuid?.() === 0;
	}

	// On Windows, we'd need to check for admin rights
	// For now, we'll return false and handle Windows separately
	// TODO: Implement Windows admin check
	return false;
}

/**
 * Get a helpful error message when elevated privileges are required
 */
export function getElevatedPrivilegesMessage(): string {
	const platform = process.platform;

	if ( platform === 'win32' ) {
		return 'The proxy server requires administrator privileges.\nPlease run this command in an elevated Command Prompt or PowerShell.';
	}

	// macOS and Linux
	return `The proxy server requires elevated privileges to bind to ports 80 and 443.\nPlease run this command with sudo:\n\n  sudo studio proxy start`;
}

/**
 * Check if elevated privileges are available and throw if not
 */
export function requireElevatedPrivileges(): void {
	if ( ! isRunningAsRoot() ) {
		throw new Error( getElevatedPrivilegesMessage() );
	}
}
