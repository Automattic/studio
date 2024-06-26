import { render, screen, fireEvent, act } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import createCodeComponent from '../assistant-code-block';

jest.mock( '../../lib/get-ipc-api' );

describe( 'createCodeComponent', () => {
	const contextProps = {
		blocks: [],
		updateMessage: jest.fn(),
		projectPath: '/path/to/project',
		messageId: 1,
	};
	const CodeBlock = createCodeComponent( contextProps );

	it( 'should render inline styles for language-generic code', () => {
		render( <CodeBlock children="example-code" /> );

		expect( screen.getByText( 'example-code' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Copy' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should display a "copy" button for language-specific code', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Copy' ) ).toBeInTheDocument();
	} );

	it( 'should display the "run" button for eligible wp-cli commands without placeholder content', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Run' ) ).toBeInTheDocument();
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
	} );

	it( 'should hide the "run" button for ineligible wp-cli commands with multiple wp-cli invocations', () => {
		render( <CodeBlock className="language-bash" children="wp --version wp --version" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	describe( 'when the "run" button is clicked', () => {
		beforeAll( () => {
			jest.useFakeTimers();
		} );

		it( 'should display an activity indicator while running code', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: 'Mock success', stderr: '' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );
			expect( screen.queryByText( 'Running...' ) ).not.toBeInTheDocument();

			fireEvent.click( screen.getByText( 'Run' ) );

			expect( screen.getByText( 'Running...' ) ).toBeInTheDocument();

			// Run code execution measurement timer
			await act( () => jest.runAllTimersAsync() );

			expect( screen.queryByText( 'Running...' ) ).not.toBeInTheDocument();
		} );

		it( 'should display the output of the successfully executed code', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: 'Mock success', stderr: '' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			fireEvent.click( screen.getByText( 'Run' ) );

			// Run code execution measurement timer
			await act( () => jest.runAllTimersAsync() );

			expect( screen.getByText( 'Success' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Mock success' ) ).toBeInTheDocument();
		} );

		it( 'should display the output of the failed code execution', async () => {
			( getIpcApi as jest.Mock ).mockReturnValue( {
				executeWPCLiInline: jest.fn().mockResolvedValue( { stdout: '', stderr: 'Mock error' } ),
			} );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			fireEvent.click( screen.getByText( 'Run' ) );

			// Run code execution measurement timer
			await act( () => jest.runAllTimersAsync() );

			expect( screen.getByText( 'Error' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Mock error' ) ).toBeInTheDocument();
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
				projectPath: '/path/to/project',
				messageId: 1,
			};
			const CodeBlock = createCodeComponent( contextProps );
			render( <CodeBlock className="language-bash" children="wp --version" /> );

			expect( screen.getByText( 'Success' ) ).toBeInTheDocument();
			expect( screen.getByText( 'Mock success' ) ).toBeInTheDocument();
		} );
	} );
} );
