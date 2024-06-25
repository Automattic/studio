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

	it( 'should display a "copy" button for language-specific code', () => {
		render( <CodeBlock className="language-bash" children="wp --version" /> );

		expect( screen.getByText( 'Copy' ) ).toBeInTheDocument();
	} );
} );
