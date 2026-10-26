import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';
import type { AiSettings } from '@studio/common/ai/providers';

const site = makeSite( { id: 'one', name: 'My site', path: '/sites/my-site' } );

const withKey = ( provider: AiSettings[ 'provider' ] ): Partial< Connector > => ( {
	getAiSettings: async () => ( {
		provider,
		hasAnthropicApiKey: true,
		anthropicApiKeyPreview: 'test',
	} ),
} );

beforeEach( () => {
	localStorage.clear();
} );

describe( 'Conversation usage and model picker', () => {
	it.each( [ 'wpcom', 'anthropic-api-key' ] as const )(
		'shows credits for the effective provider with a saved key: %s',
		async ( provider ) => {
			const connector = createFakeConnector(
				{ sites: [ site ] },
				{
					...withKey( provider ),
					getStudioAssistantQuota: async () => ( {
						costCap: 1000,
						costResetDate: undefined,
						studioCodeAiHasAccess: undefined,
						studioCodeAiAccess: undefined,
						costUsage: 400,
						allowanceRemaining: 600,
						purchasedRemaining: 0,
						purchasedAtTopUp: 0,
						emailVerified: true,
						hasPaymentMethod: true,
					} ),
				}
			);
			const { user } = renderApp( { connector, path: '/sites/one/new' } );
			await screen.findByRole( 'button', { name: 'Site actions for My site' } );
			await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
			if ( provider === 'wpcom' ) {
				expect( await screen.findByRole( 'option', { name: /Fast/ } ) ).toHaveTextContent(
					'Quick fixes and questions'
				);
				expect( screen.getByRole( 'option', { name: /Balanced/ } ) ).toHaveAttribute(
					'aria-disabled',
					'true'
				);
				expect( screen.getByRole( 'option', { name: /Strong/ } ) ).toHaveTextContent(
					'Purchased credits required'
				);
			}
			expect( await screen.findByRole( 'option', { name: /^Sonnet 5/ } ) ).toBeVisible();
			expect( screen.getByRole( 'option', { name: /^Connect provider…/ } ) ).toBeVisible();
			await user.keyboard( '{Escape}' );
			if ( provider === 'wpcom' ) {
				expect( await screen.findByRole( 'button', { name: 'Model' } ) ).toHaveAttribute(
					'aria-description',
					expect.stringContaining( 'AI credits: 600 remaining' )
				);
			} else {
				expect( screen.getByRole( 'button', { name: 'Model' } ) ).not.toHaveAttribute(
					'aria-description',
					expect.stringContaining( 'AI credits:' )
				);
			}
			expect( screen.queryByRole( 'combobox', { name: 'AI provider' } ) ).not.toBeInTheDocument();
		}
	);

	it( 'selects the personal-key model and its provider from one footer picker', async () => {
		const connector = createFakeConnector( { sites: [ site ] }, withKey( 'wpcom' ) );
		const { user } = renderApp( { connector, path: '/sites/one/new' } );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		await user.click( await screen.findByRole( 'button', { name: 'Model' } ) );
		await user.click( await screen.findByRole( 'option', { name: /^Sonnet 5/ } ) );
		await waitFor( () =>
			expect( connector.setSessionProvider ).toHaveBeenCalledWith(
				expect.any( String ),
				'anthropic-api-key',
				'claude-sonnet-5'
			)
		);
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Model' } ) ).toHaveTextContent( 'Sonnet 5' )
		);
		expect( screen.getByRole( 'button', { name: 'Model' } ) ).not.toHaveAttribute(
			'aria-description',
			expect.stringContaining( 'AI credits:' )
		);
	} );
} );
