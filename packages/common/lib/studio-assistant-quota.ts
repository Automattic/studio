import { z } from 'zod';

export const STUDIO_ASSISTANT_QUOTA_URL =
	'https://public-api.wordpress.com/wpcom/v2/studio-app/ai-assistant/quota';

export const studioAssistantQuotaSchema = z
	.object( {
		cost_usage: z.number(),
		cost_cap: z.number(),
		cost_reset_date: z.string(),
	} )
	.transform( ( data ) => ( {
		costUsage: data.cost_usage,
		costCap: data.cost_cap,
		costResetDate: data.cost_reset_date,
	} ) );

export type StudioAssistantQuota = z.infer< typeof studioAssistantQuotaSchema >;
