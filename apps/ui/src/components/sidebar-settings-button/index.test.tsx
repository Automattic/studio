import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { forwardRef, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarSettingsButton } from './index';

const routerState = vi.hoisted( () => ( {
	pathname: '/settings',
	search: {} as Record< string, string >,
} ) );

vi.mock( '@tanstack/react-router', () => ( {
	Link: forwardRef<
		HTMLAnchorElement,
		{
			to: string;
			search?: Record< string, string >;
			className?: string;
			activeOptions?: { exact?: boolean; includeSearch?: boolean };
			activeProps?: { className?: string };
			children: ReactNode;
		}
	>( function MockLink( { to, search, className, activeOptions, activeProps, children }, ref ) {
		const pathMatches = activeOptions?.exact
			? routerState.pathname === to
			: routerState.pathname.startsWith( to );
		const searchMatches =
			activeOptions?.includeSearch === false ||
			Object.entries( search ?? {} ).every(
				( [ key, value ] ) => routerState.search[ key ] === value
			);

		return (
			<a
				ref={ ref }
				href={ to }
				className={ pathMatches && searchMatches ? activeProps?.className : className }
			>
				{ children }
			</a>
		);
	} ),
} ) );

vi.mock( './style.module.css', () => ( {
	default: {
		root: 'root',
		button: 'button',
		buttonActive: 'buttonActive',
		label: 'label',
	},
} ) );

describe( 'SidebarSettingsButton', () => {
	beforeEach( () => {
		routerState.pathname = '/settings';
		routerState.search = {};
	} );

	it.each( [ 'account', 'preferences' ] )(
		'highlights the settings row when the %s settings tab is active',
		( tab ) => {
			routerState.search = { tab };

			render( <SidebarSettingsButton /> );

			expect( screen.getByRole( 'link', { name: 'Settings' } ) ).toHaveClass( 'buttonActive' );
		}
	);

	it( 'does not highlight the settings row on other routes', () => {
		routerState.pathname = '/sites/site-1';

		render( <SidebarSettingsButton /> );

		expect( screen.getByRole( 'link', { name: 'Settings' } ) ).not.toHaveClass( 'buttonActive' );
	} );
} );
