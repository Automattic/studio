import { render, screen } from '@testing-library/react';
import createCodeComponent from '../assistant-code-block';

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

	it( 'should display the "run" button for elligble wp-cli commands without placeholder content', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Run' ) ).toBeInTheDocument();
	} );

	it( 'should hide the "run" button for inellible non-wp-cli code', () => {
		render(
			<CodeBlock className="language-bash" children="wp plugin activate <example-plugin>" />
		);

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should hide the "run" button for inellible wp-cli commands with placeholder content', () => {
		render(
			<CodeBlock className="language-bash" children="wp plugin activate <example-plugin>" />
		);

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );

	it( 'should hide the "run" button for inellible wp-cli commands with multiple wp-cli invocations', () => {
		render( <CodeBlock className="language-bash" children="wp --version wp --version" /> );

		expect( screen.queryByText( 'Run' ) ).not.toBeInTheDocument();
	} );
} );
