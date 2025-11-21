/**
 * PM2 Process Types for Studio CLI
 *
 * Shared type definitions for PM2 process management
 */

/**
 * Description of a PM2 process instance
 */
export interface ProcessDescription {
	name: string;
	pmId: number;
	status: string;
	pid?: number;
}
