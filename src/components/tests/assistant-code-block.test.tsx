import { act, render, screen, fireEvent } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import createCodeComponent from '../assistant-code-block';

jest.mock( '../../lib/get-ipc-api' );

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
} );
