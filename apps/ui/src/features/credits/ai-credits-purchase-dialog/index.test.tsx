import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStudioAssistantTopUpPricing } from '@/data/queries/use-top-up-pricing';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AiCreditsPurchaseDialog } from './index';
import type { StudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';

// A currency whose price can't be reconstructed from the minor units, so the
// cards must echo `display` rather than compute anything.
const GBP: StudioAssistantTopUpPricing[ 'options' ] = [
	{ credits: 100000, display: '£7.50' },
	{ credits: 200000, display: '£15' },
	{ credits: 500000, display: '£37.50' },
	{ credits: 1000000, display: '£75' },
];

function OpenOncePriced() {
	const { data } = useStudioAssistantTopUpPricing();
	return <AiCreditsPurchaseDialog open={ !! data } onOpenChange={ () => {} } />;
}

async function setup( options = GBP ) {
	const connector = createFakeConnector(
		{},
		{
			getStudioAssistantTopUpPricing: async () => ( { options } ),
			getAppGlobals: async () => ( { platform: 'browser', isWindowsStore: false } ),
		}
	);
	renderWithProviders( <OpenOncePriced />, { connector } );
	await screen.findByRole( 'dialog' );
	return connector;
}

describe( 'AI credits purchase dialog', () => {
	it( 'offers a card per priced amount and preselects the cheapest', async () => {
		await setup();
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 4 );
		expect( screen.getByText( '£7.50' ) ).toBeVisible();
		expect( screen.getByRole( 'radio', { name: /100,000 credits/ } ) ).toBeChecked();
		expect( screen.getByRole( 'button', { name: 'Continue for £7.50' } ) ).toBeVisible();
		await waitFor( () =>
			expect( screen.getByRole( 'radio', { name: /100,000 credits/ } ) ).toHaveFocus()
		);
	} );

	it( 'renders however many amounts came back', async () => {
		await setup( GBP.slice( 0, 2 ) );
		expect( screen.getAllByRole( 'radio' ) ).toHaveLength( 2 );
	} );

	it( 'uses one tab stop and arrow keys to move through the amounts', async () => {
		await setup();
		const radios = screen.getAllByRole( 'radio' );
		expect( radios.map( ( radio ) => radio.tabIndex ) ).toEqual( [ 0, -1, -1, -1 ] );
		fireEvent.keyDown( radios[ 0 ], { key: 'ArrowLeft' } );
		expect( radios[ 3 ] ).toBeChecked();
		expect( radios[ 3 ] ).toHaveFocus();
		expect( radios.map( ( radio ) => radio.tabIndex ) ).toEqual( [ -1, -1, -1, 0 ] );
	} );

	it( 'checks out the selected amount', async () => {
		const connector = await setup();
		fireEvent.click( screen.getByRole( 'radio', { name: /500,000 credits/ } ) );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue for £37.50' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-500000'
		);
	} );

	it( 'cannot check out when nothing could be priced', async () => {
		const connector = await setup( [] );
		expect( screen.queryAllByRole( 'radio' ) ).toHaveLength( 0 );
		fireEvent.click( screen.getByRole( 'button', { name: 'Continue' } ) );
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
	} );
} );
