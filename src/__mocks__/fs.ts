type Fs = typeof import('fs');
interface MockedFs extends Fs {
	__setFileContents: ( path: string, fileContents: string | string[] ) => void;
}

const fs = jest.createMockFromModule< MockedFs >( 'fs' );
const fsPromises = jest.createMockFromModule< typeof import('fs/promises') >( 'fs/promises' );

fs.promises = fsPromises;

const mockFiles: Record< string, string | string[] > = {};
fs.__setFileContents = ( path: string, fileContents: string | string[] ) => {
	mockFiles[ path ] = fileContents;
};

( fs.promises.readFile as jest.Mock ).mockImplementation(
	async ( path: string ): Promise< string > => {
		const fileContents = mockFiles[ path ];

		if ( typeof fileContents === 'string' ) {
			return fileContents;
		}

		return '';
	}
);

( fs.promises.readdir as jest.Mock ).mockImplementation(
	async ( path: string ): Promise< Array< string > > => {
		const dirContents = mockFiles[ path ];

		if ( Array.isArray( dirContents ) ) {
			return dirContents;
		}

		return [];
	}
);

module.exports = fs;
