import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppProviders } from '@/app/app-providers';
import { getNoticeHistory } from '@/data/app-messages';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { createTestQueryClient } from '@/test/render';
import { useActivePersistentMessages, useRecordPersistentMessages } from './use-app-messages';
import { ASSISTANT_QUOTA_QUERY_KEY } from './use-assistant-quota';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import type { ReactNode } from 'react';

const quotaAt = ( fraction: number ) =>
	( {
		costUsage: 0,
		costCap: 1000000,
		allowanceRemaining: Math.round( 1000000 * ( 1 - fraction ) ),
	} ) as StudioAssistantQuota;

async function renderMessages( fraction: number ) {
	const connector = createFakeConnector();
	connector.getStudioAssistantQuota.mockResolvedValue( quotaAt( fraction ) );
	const queryClient = createTestQueryClient();
	const view = renderHook(
		() => {
			useRecordPersistentMessages();
			return useActivePersistentMessages();
		},
		{
			wrapper: ( { children }: { children: ReactNode } ) => (
				<AppProviders connector={ connector } queryClient={ queryClient }>
					{ children }
				</AppProviders>
			),
		}
	);
	await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
	const setUsage = ( next: number ) =>
		act( async () => {
			queryClient.setQueryData( [ ...ASSISTANT_QUOTA_QUERY_KEY, TEST_USER.id ], quotaAt( next ) );
			// TanStack Query notifies observers on a timeout.
			await new Promise( ( resolve ) => setTimeout( resolve ) );
		} );
	const creditsMessages = () =>
		view.result.current.messages.filter( ( message ) => message.id.startsWith( 'ai-credits:' ) );
	const dismiss = () => act( () => view.result.current.dismiss( creditsMessages()[ 0 ] ) );
	return { creditsMessages, setUsage, dismiss };
}

describe( 'AI credits sidebar notice', () => {
	it( 'warns once usage reaches 80%, reporting the live figure', async () => {
		const { creditsMessages } = await renderMessages( 0.83 );
		await waitFor( () =>
			expect( creditsMessages() ).toEqual( [
				expect.objectContaining( {
					id: 'ai-credits:warning',
					title: 'At 83% usage',
					description: 'Add AI credits to keep chatting without interruption.',
					purchaseCta: true,
				} ),
			] )
		);
	} );

	it.each( [
		[ 'below 80%', 0.5 ],
		[ 'at 90%, which the composer strip shows', 0.9 ],
		[ 'once exhausted, which the composer lockout shows', 1 ],
	] )( 'stays quiet %s', async ( _, fraction ) => {
		const { creditsMessages, setUsage } = await renderMessages( 0.83 );
		await waitFor( () => expect( creditsMessages() ).toHaveLength( 1 ) );
		await setUsage( fraction );
		expect( creditsMessages() ).toEqual( [] );
	} );

	it( 'stays dismissed while usage sits at the same step', async () => {
		const { creditsMessages, setUsage, dismiss } = await renderMessages( 0.83 );
		await waitFor( () => expect( creditsMessages() ).toHaveLength( 1 ) );
		dismiss();
		await setUsage( 0.85 );
		expect( creditsMessages() ).toEqual( [] );
	} );

	it.each( [
		[ 'a trip through 90%', 0.92 ],
		[ 'a top-up below the dismissed step', 0.5 ],
	] )( 're-arms after %s', async ( _, detour ) => {
		const { creditsMessages, setUsage, dismiss } = await renderMessages( 0.83 );
		await waitFor( () => expect( creditsMessages() ).toHaveLength( 1 ) );
		dismiss();
		await setUsage( detour );
		expect( creditsMessages() ).toEqual( [] );
		await setUsage( 0.85 );
		expect( creditsMessages() ).toEqual( [
			expect.objectContaining( { id: 'ai-credits:warning' } ),
		] );
	} );

	it( 'logs the card to the notification history and keeps it after dismissal', async () => {
		const { creditsMessages, dismiss } = await renderMessages( 0.83 );
		await waitFor( () =>
			expect( getNoticeHistory() ).toEqual( [
				expect.objectContaining( {
					id: 'ai-credits:warning',
					intent: 'warning',
					title: 'At 83% usage',
				} ),
			] )
		);
		dismiss();
		expect( creditsMessages() ).toEqual( [] );
		expect( getNoticeHistory() ).toHaveLength( 1 );
	} );
} );
