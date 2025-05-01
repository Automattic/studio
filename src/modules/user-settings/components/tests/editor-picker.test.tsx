import { render, screen, fireEvent } from '@testing-library/react';
import { useGetInstalledAppsQuery } from 'src/stores/installed-apps-api';
import { EditorPicker } from '../editor-picker';

// Mock the IPC API
jest.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: jest.fn( () => ( {
		openURL: jest.fn(),
		getUserEditor: jest.fn().mockResolvedValue( undefined ),
	} ) ),
} ) );

// Mock the installed apps query hook
jest.mock( 'src/stores/installed-apps-api', () => ( {
	useGetInstalledAppsQuery: jest.fn(),
	selectInstalledEditors: jest.fn(),
	selectUninstalledEditors: jest.fn(),
} ) );

describe( 'EditorPicker', () => {
	const mockOnChange = jest.fn();

	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'renders select control with no editors installed', () => {
		( useGetInstalledAppsQuery as jest.Mock ).mockReturnValue( {
			installedEditors: [],
			uninstalledEditors: [],
		} );

		render( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		expect( screen.getByRole( 'combobox' ) ).toBeDisabled();
		expect( screen.getByText( 'No supported editors found' ) ).toBeInTheDocument();
	} );

	it( 'renders select control with installed editors without preselected value', () => {
		( useGetInstalledAppsQuery as jest.Mock ).mockReturnValue( {
			installedEditors: [ [ 'vscode', { label: 'VS Code' } ] ],
			uninstalledEditors: [ [ 'cursor', { label: 'Cursor' } ] ],
		} );

		render( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = screen.getByRole( 'combobox' );
		expect( select ).not.toBeDisabled();
		expect( screen.getByText( 'Select' ) ).toBeInTheDocument();
		expect( screen.getByText( 'VS Code' ) ).toBeInTheDocument();
		expect( select.querySelector( 'optgroup[label="Not installed"]' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Cursor' ) ).toBeInTheDocument();
		expect(
			screen.queryByText( 'We recommend using Visual Studio Code ↗.' )
		).not.toBeInTheDocument();
	} );

	it( 'handles editor selection change', () => {
		( useGetInstalledAppsQuery as jest.Mock ).mockReturnValue( {
			installedEditors: [ [ 'vscode', { label: 'VS Code' } ] ],
			uninstalledEditors: [],
		} );

		render( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = screen.getByRole( 'combobox' );
		fireEvent.change( select, { target: { value: 'vscode' } } );

		expect( mockOnChange ).toHaveBeenCalledWith( 'vscode' );
	} );

	it( 'disables uninstalled editors in the select', () => {
		( useGetInstalledAppsQuery as jest.Mock ).mockReturnValue( {
			installedEditors: [ [ 'vscode', { label: 'VS Code' } ] ],
			uninstalledEditors: [ [ 'cursor', { label: 'Cursor' } ] ],
		} );

		render( <EditorPicker value={ undefined } onChange={ mockOnChange } /> );

		const select = screen.getByRole( 'combobox' );
		const options = select.querySelectorAll( 'option' );
		// First option should be enabled (Select)
		expect( options[ 0 ] ).not.toBeDisabled();
		// Second option should be enabled (VS Code)
		expect( options[ 1 ] ).not.toBeDisabled();
		// Third option should be disabled (Cursor)
		expect( options[ 2 ] ).toBeDisabled();
	} );
} );
