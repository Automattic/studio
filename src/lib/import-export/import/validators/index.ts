import { Validator } from './Validator';
import { JetpackValidator } from './jetpack-validator';

export * from './Validator';
export * from './jetpack-validator';

export const allValidators: Validator[] = [ new JetpackValidator() ];
