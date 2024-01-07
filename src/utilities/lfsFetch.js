import { GithubLfsResolver } from "./GithubLfsResolver";

const resolver = new GithubLfsResolver();
resolver.pagesStem = location.origin;
resolver.targetBranch = 'main';
resolver.targetStem = 'raw.githubusercontent.com';

export function lfsFetch( url, options ) {

	if ( /github.io/.test( location.href ) ) {

		url = resolver.resolve( url );

	}

	return fetch( url, options );

}
