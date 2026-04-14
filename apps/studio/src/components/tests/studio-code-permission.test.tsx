import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StudioCodePermission } from 'src/components/studio-code-permission';
import type { PermissionRequest } from 'src/components/studio-code-types';

describe( 'StudioCodePermission', () => {
	const mockPermission: PermissionRequest = {
		id: 'perm_1',
		question: 'Allow Write to access /Users/test/file.txt?',
		options: [ 'Allow once', 'Allow for this session', 'Deny' ],
	};

	it( 'renders permission request with option buttons', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( 'Permission Required' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Allow once' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Allow for this session' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Deny' ) ).toBeInTheDocument();
	} );

	it( 'renders the question', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		expect( screen.getByText( 'Allow Write to access /Users/test/file.txt?' ) ).toBeInTheDocument();
	} );

	it( 'calls onRespond with the selected option label', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		fireEvent.click( screen.getByText( 'Allow once' ) );
		expect( onRespond ).toHaveBeenCalledWith( 'perm_1', 'Allow once' );
	} );

	it( 'calls onRespond with Deny when Deny clicked', () => {
		const onRespond = vi.fn();
		render( <StudioCodePermission permission={ mockPermission } onRespond={ onRespond } /> );
		fireEvent.click( screen.getByText( 'Deny' ) );
		expect( onRespond ).toHaveBeenCalledWith( 'perm_1', 'Deny' );
	} );
} );
