import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { useWapuuScore } from '@/data/queries/use-wapuu-score';
import { WapuuScore } from './wapuu-score';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

vi.mock( '@wordpress/ui', () => ( {
	Button: ( {
		children,
		tone,
		variant,
		size,
		...props
	}: ButtonHTMLAttributes< HTMLButtonElement > & {
		children?: ReactNode;
		tone?: string;
		variant?: string;
		size?: string;
	} ) => {
		void tone;
		void variant;
		void size;
		return <button { ...props }>{ children }</button>;
	},
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

vi.mock( '@/data/queries/use-wapuu-score', () => ( {
	useWapuuScore: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );
const useWapuuScoreMock = vi.mocked( useWapuuScore );

describe( 'WapuuScore', () => {
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		useConnectorMock.mockReturnValue( { openExternalUrl } as never );
	} );

	it( 'renders nothing when no score has been recorded', () => {
		useWapuuScoreMock.mockReturnValue( { data: null } as never );

		const { container } = render( <WapuuScore /> );

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'shows the score and a progressbar once a score exists', () => {
		useWapuuScoreMock.mockReturnValue( { data: 1200 } as never );

		render( <WapuuScore /> );

		expect( screen.getByText( /1200 of \d+ points/ ) ).toBeInTheDocument();
		const bar = screen.getByRole( 'progressbar', { name: 'Wapuu score' } );
		expect( bar ).toHaveAttribute( 'aria-valuenow', '1200' );
	} );

	it( 'opens wapuu.studio through the connector', () => {
		useWapuuScoreMock.mockReturnValue( { data: 1200 } as never );

		render( <WapuuScore /> );
		fireEvent.click( screen.getByRole( 'button', { name: 'Visit wapuu.studio' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://wapuu.studio' );
	} );
} );
