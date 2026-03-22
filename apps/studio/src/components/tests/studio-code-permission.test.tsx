import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StudioCodePermission } from 'src/components/studio-code-permission';
import type { PermissionRequest } from 'src/components/studio-code-types';

describe( 'StudioCodePermission', () => {
	const mockPermission: PermissionRequest = {
		id: 'perm_1',
		toolName: 'Write',
		input: { file_path: '/Users/test/file.txt' },
		description: 'Write to /Users/test/file.txt',
	};

	it( 'renders permission request with Allow and Deny buttons', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( 'Permission Required' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Allow' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Deny' ) ).toBeInTheDocument();
	} );

	it( 'renders the tool name', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( 'Write' ) ).toBeInTheDocument();
	} );

	it( 'renders the description', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( 'Write to /Users/test/file.txt' ) ).toBeInTheDocument();
	} );

	it( 'calls onRespond with allowed=true when Allow clicked', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		fireEvent.click( screen.getByText( 'Allow' ) );
		expect( onRespond ).toHaveBeenCalledWith( 'perm_1', true );
	} );

	it( 'calls onRespond with allowed=false when Deny clicked', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		fireEvent.click( screen.getByText( 'Deny' ) );
		expect( onRespond ).toHaveBeenCalledWith( 'perm_1', false );
	} );

	it( 'renders input JSON when input has keys', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( /file_path/ ) ).toBeInTheDocument();
	} );

	it( 'does not render input JSON when input is empty', () => {
		const onRespond = vi.fn();
		const emptyInputPermission: PermissionRequest = {
			...mockPermission,
			input: {},
		};
		render( <StudioCodePermission permission={ emptyInputPermission } onRespond={ onRespond } /> );
		expect( screen.queryByText( /file_path/ ) ).not.toBeInTheDocument();
	} );
} );
