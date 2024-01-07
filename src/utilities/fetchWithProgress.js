import { lfsFetch } from './lfsFetch.js';

export function fetchWithProgress( url, progressCallback = null ) {

	return lfsFetch( url )
		.then( response => {

			if ( response.status === 200 || response.status === 0 ) {

				// Some browsers return HTTP Status 0 when using non-http protocol
				// e.g. 'file://' or 'data://'. Handle as success.

				if ( response.status === 0 ) {

					console.warn( 'THREE.FileLoader: HTTP Status 0 received.' );

				}

				// Workaround: Checking if response.body === undefined for Alipay browser mrdoob/three#23548
				if ( typeof ReadableStream === 'undefined' || response.body === undefined || response.body.getReader === undefined ) {

					return response;

				}

				const reader = response.body.getReader();
				const contentLength = response.headers.get( 'Content-Length' );
				const total = contentLength ? parseInt( contentLength ) : 0;
				const lengthComputable = total !== 0;
				let loaded = 0;

				// periodically read data into the new stream tracking while download progress
				const stream = new ReadableStream( {
					start( controller ) {

						readData();

						function readData() {

							reader.read().then( ( { done, value } ) => {

								if ( done ) {

									controller.close();
									if ( progressCallback ) progressCallback( total, total, lengthComputable );

								} else {

									loaded += value.byteLength;
									if ( progressCallback ) progressCallback( loaded, total, lengthComputable );

									controller.enqueue( value );
									readData();

								}

							} );

						}

					}

				} );

				return new Response( stream );

			} else {

				throw new HttpError( `fetch for "${response.url}" responded with ${response.status}: ${response.statusText}`, response );

			}

		} );

}
