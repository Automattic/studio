import sudo from '@vscode/sudo-prompt';

type SudoExecParams = Parameters< typeof sudo.exec >;
export const sudoExec = (
	command: SudoExecParams[ 0 ],
	options?: SudoExecParams[ 1 ]
): Promise< void > => {
	return new Promise( ( resolve, reject ) => {
		sudo.exec( command, options, ( error ) => {
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
};
