import { z } from 'zod';

export const wpcomSiteVisibilitySchema = z.enum( [ 'public', 'coming-soon', 'private' ] );
export type WpcomSiteVisibility = z.infer< typeof wpcomSiteVisibilitySchema >;

export type WpcomSiteVisibilityDetails = {
	visibility: WpcomSiteVisibility;
	url: string;
	launchStatus?: string;
};
