import { render, screen } from '@testing-library/react';
import { ContentTabAssistant } from '../content-tab-assistant';

jest.mock( '../../hooks/use-theme-details' );

const runningSite: StartedSiteDetails = {
	name: 'Test Site',
	port: 8881,
	path: '/path/to/site',
	running: true,
	id: 'site-id',
	url: 'http://example.com',
};

describe( 'ContentTabAssistant', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	test( 'renders placeholder text input', () => {
		render( <ContentTabAssistant selectedSite={ runningSite } /> );

		const textInput = screen.getByPlaceholderText( 'Ask Studio WordPress Assistant' );
		expect( textInput ).toBeInTheDocument();
	} );
} );
