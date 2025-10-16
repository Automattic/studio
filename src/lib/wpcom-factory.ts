import wpcomModule from 'wpcom';
import wpcomXhrRequest from 'wpcom-xhr-request';

const wpcomFactory = ( token?: string ) => {
	if ( token ) {
		return wpcomModule( token, wpcomXhrRequest );
	}
	return wpcomModule( wpcomXhrRequest );
};

export default wpcomFactory;
