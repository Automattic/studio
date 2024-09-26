import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSiteDetails } from '../../hooks/use-site-details';
import { getIpcApi } from '../../lib/get-ipc-api';
import createCodeComponent from '../assistant-code-block';

jest.mock( '../../lib/get-ipc-api' );
jest.mock( '../../hooks/use-check-installed-apps', () => ( {
	useCheckInstalledApps: jest.fn().mockReturnValue( {
		vscode: true,
		phpstorm: false,
	} ),
} ) );
jest.mock( '../../hooks/use-site-details' );

const selectedSite: SiteDetails = {
	id: 'site-id-1',
	name: 'Test Site',
	running: false,
	path: '/test-site',
	phpVersion: '8.0',
	adminPassword: btoa( 'test-password' ),
};

( useSiteDetails as jest.Mock ).mockReturnValue( {
	data: [ selectedSite ],
	loadingSites: false,
	selectedSite: selectedSite,
} );

describe( 'createCodeComponent', () => {
	const contextProps = {
		blocks: [],
		updateMessage: jest.fn(),
		siteId: '1',
		messageId: 1,
	};
	const CodeBlock = createCodeComponent( contextProps );

	it( 'should render inline styles for language-generic code', () => {
		render( <CodeBlock children="example-code" /> );

		expect( screen.getByText( 'example-code' ) ).toBeVisible();
		expect( screen.queryByText( 'Copy' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should display a "copy" button for language-specific code', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Copy' ) ).toBeVisible();
	} );

	it( 'should display the "run" button for eligible wp-cli commands without placeholder content', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Run' ) ).toBeVisible();
	} );

	it( 'should hide the "run" button for ineligible non-wp-cli code', () => {
		render( <CodeBlock className="language-bash" children="echo 'Hello, World!'" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should hide the "run" button for ineligible wp-cli commands with placeholder content', () => {
		render(
			<CodeBlock className="language-bash" children="wp plugin activate <example-plugin>" />
		);
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();

		render(
			<CodeBlock className="language-bash" children="wp plugin activate [example-plugin]" />
		);
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();

		render(
			<CodeBlock className="language-bash" children="wp plugin activate {example-plugin}" />
		);
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();

		render(
			<CodeBlock className="language-bash" children="wp plugin activate (example-plugin)" />
		);
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should hide the "run" button for ineligible wp-cli commands with multiple wp-cli invocations', () => {
		render( <CodeBlock className="language-bash" children="wp --version wp --version" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );
	it( 'should hide the "run" button for unsupported commands db', () => {
		render( <CodeBlock className="language-bash" children="wp db export" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );
	it( 'should hide the "run" button for unsupported commands shell', () => {
		render( <CodeBlock className="language-bash" children="wp shell" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );
	it( 'should hide the "run" button for unsupported commands server', () => {
		render( <CodeBlock className="language-bash" children="wp server" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should display the "run" button for elligble wp-cli commands that contain a placeholder char', () => {
		render( <CodeBlock className="language-bash" children="wp eval 'var_dump(3 < 4);'" /> );

		expect( screen.getByText( 'Run' ) ).toBeInTheDocument();
	} );

	describe( 'when the "run" button is clicked', () => {
		beforeEach( () => {
			jest.useFakeTimers();
		} );

		afterEach( () => {
			jest.useRealTimers();
		} );

		it( 'should display an activity indicator while running code', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: 'Mock success', stderr: '' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );
			expect( screen.queryByText( 'Running...' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByText( 'Run' ) );

			expect( screen.getByText( 'Running...' ) ).toBeVisible();

			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( screen.queryByText( 'Running...' ) ).not.toBeInTheDocument();
		} );

		it( 'should display the output of the successfully executed code', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: 'Mock success', stderr: '' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			fireEvent.click( screen.getByText( 'Run' ) );

			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( screen.getByText( 'Success' ) ).toBeVisible();
			expect( screen.getByText( 'Mock success' ) ).toBeVisible();
		} );

		it( 'should display the output of the failed code execution', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: '', stderr: 'Mock error' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			fireEvent.click( screen.getByText( 'Run' ) );

			await act( () => jest.runOnlyPendingTimersAsync() );

			expect( screen.getByText( 'Error' ) ).toBeVisible();
			expect( screen.getByText( 'Mock error' ) ).toBeVisible();
		} );
	} );

	describe( 'when the "copy" button is clicked', () => {
		it( 'should copy the code content to the clipboard', async () => {
			const mockCopyText = jest.fn();
			( getIpcApi as jest.Mock ).mockReturnValue( {
				copyText: mockCopyText,
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			fireEvent.click( screen.getByText( 'Copy' ) );

			expect( mockCopyText ).toHaveBeenCalledWith( 'wp --version' );
		} );
	} );

	describe( 'when past block execution output is present', () => {
		it( 'should display the output of the previously executed code', async () => {
			const contextProps = {
				blocks: [
					{
						codeBlockContent: 'wp --version',
						cliOutput: 'Mock success',
						cliStatus: 'success' as const,
						cliTime: '2.3s',
					},
				],
				updateMessage: jest.fn(),
				siteId: '1',
				messageId: 1,
			};
			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			expect( screen.getByText( 'Success' ) ).toBeVisible();
			expect( screen.getByText( 'Mock success' ) ).toBeVisible();
		} );
	} );

	describe( 'when content is a file path', () => {
		it( 'should open a file in the IDE if the file exists', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				getAbsolutePathFromSite: jest
					.fn()
					.mockResolvedValue( 'site-path/wp-content/plugins/hello.php' ),
				openFileInIDE: jest.fn(),
			} );

			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock children="wp-content/plugins/hello.php" /> );

			await waitFor( () => {
				expect( screen.getByText( 'wp-content/plugins/hello.php' ) ).toBeVisible();
				expect( screen.getByText( 'wp-content/plugins/hello.php' ) ).toHaveClass( 'file-block' );
			} );

			fireEvent.click( screen.getByText( 'wp-content/plugins/hello.php' ) );
			expect( getIpcApi().openFileInIDE ).toHaveBeenCalledWith(
				'wp-content/plugins/hello.php',
				'1'
			);
		} );

		it( 'should not open a file in the IDE if the file does not exist', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				getAbsolutePathFromSite: jest.fn().mockResolvedValue( null ),
				openFileInIDE: jest.fn(),
			} );

			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock children="wp-content/debug.log" /> );

			await waitFor( () => {
				expect( screen.getByText( 'wp-content/debug.log' ) ).toBeVisible();
				expect( screen.getByText( 'wp-content/debug.log' ) ).not.toHaveClass( 'file-block' );
			} );

			fireEvent.click( screen.getByText( 'wp-content/debug.log' ) );
			expect( getIpcApi().openFileInIDE ).not.toHaveBeenCalled();
		} );

		it( 'should open a directory in the Finder if the directory exists', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				getAbsolutePathFromSite: jest.fn().mockResolvedValue( 'site-path/wp-content/plugins' ),
				openLocalPath: jest.fn(),
			} );

			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock children="wp-content/plugins" /> );

			await waitFor( () => {
				expect( screen.getByText( 'wp-content/plugins' ) ).toBeVisible();
				expect( screen.getByText( 'wp-content/plugins' ) ).toHaveClass( 'file-block' );
			} );

			fireEvent.click( screen.getByText( 'wp-content/plugins' ) );
			expect( getIpcApi().openLocalPath ).toHaveBeenCalledWith( 'site-path/wp-content/plugins' );
		} );

		it( 'should not open a directory in the Finder if the directory does not exist', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				getAbsolutePathFromSite: jest.fn().mockResolvedValue( null ),
				openLocalPath: jest.fn(),
			} );

			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock children="wp-content/plugins" /> );

			await waitFor( () => {
				expect( screen.getByText( 'wp-content/plugins' ) ).toBeVisible();
				expect( screen.getByText( 'wp-content/plugins' ) ).not.toHaveClass( 'file-block' );
			} );

			fireEvent.click( screen.getByText( 'wp-content/plugins' ) );
			expect( getIpcApi().openLocalPath ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'when the "copy and open terminal" button is clicked', () => {
		it( 'should not be visible for non-bash code blocks', () => {
			render( <CodeBlock className="language-php" children="<?php echo 'Hello'; ?>" /> );

			expect( screen.queryByText( 'Copy and open terminal' ) ).not.toBeInTheDocument();
		} );

		it( 'should be visible for bash code blocks', () => {
			render( <CodeBlock className="language-bash" children="wp plugin list" /> );

			expect( screen.getByText( 'Copy and open terminal' ) ).toBeVisible();
		} );

		it( 'should be visible for sh code blocks', () => {
			render( <CodeBlock className="language-sh" children="wp plugin list" /> );

			expect( screen.getByText( 'Copy and open terminal' ) ).toBeVisible();
		} );

		it( 'should copy the code content to the clipboard and open terminal', async () => {
			render( <CodeBlock className="language-bash" children="wp plugin list" /> );

			fireEvent.click( screen.getByText( 'Copy and open terminal' ) );

			expect( getIpcApi().copyText ).toHaveBeenCalledWith( 'wp plugin list' );
			expect( getIpcApi().openTerminalAtPath ).toHaveBeenCalledWith(
				selectedSite.path,
				expect.any( Object )
			);
		} );
	} );
} );
