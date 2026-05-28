import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { cloneElement, isValidElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarNav } from './index';
import type { ReactNode } from 'react';

vi.mock( '@tanstack/react-router', () => ( {
	Link: ( { children, to }: { children?: ReactNode; to: string } ) => (
		<a href={ to }>{ children }</a>
	),
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( text: string ) => text,
} ) );

vi.mock( '@wordpress/icons', () => ( {
	category: {},
	cog: {},
	comment: {},
	layout: {},
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Button: ( { children, render }: { children?: ReactNode; render?: ReactNode } ) => {
		if ( render ) {
			return <>{ render }</>;
		}

		return <button type="button">{ children }</button>;
	},
	Icon: () => null,
} ) );

vi.mock( '@/components/sidebar-button', () => ( {
	SidebarButton: ( { children, render }: { children?: ReactNode; render?: ReactNode } ) => {
		if ( isValidElement( render ) ) {
			return cloneElement( render, undefined, children );
		}

		return <button type="button">{ children }</button>;
	},
} ) );

describe( 'SidebarNav', () => {
	it( 'renders Chat, Desk, Settings as links and keeps Skills visible as a label', () => {
		render( <SidebarNav /> );

		const nav = screen.getByRole( 'navigation' );
		const links = within( nav ).getAllByRole( 'link' );

		expect( links.map( ( link ) => link.textContent ) ).toEqual( [ 'Chat', 'Desk', 'Settings' ] );
		expect( screen.getByRole( 'link', { name: 'Desk' } ) ).toHaveAttribute( 'href', '/desk' );

		expect( screen.getByText( 'Skills' ) ).toBeVisible();
		expect( screen.queryByRole( 'link', { name: 'Skills' } ) ).not.toBeInTheDocument();
	} );
} );
