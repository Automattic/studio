import dns from 'dns';
/**
 * Network utility function for checking online status and detecting offline mode
 */

/**
 * Check if the system is online by attempting to resolve a known host
 * @param hostname - The hostname to check (defaults to 'google.com')
 * @returns Promise<boolean> - true if online, false if offline
 */
export async function isOnline(hostname: string = 'google.com'): Promise<boolean> {
	try {
		await dns.promises.lookup(hostname);
		return true;
	} catch (err) {
		return false;
	}
}