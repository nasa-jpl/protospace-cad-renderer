import '../lib/lzf.js';
import * as THREE from 'three';
import ThreadQueue from 'threading-js/ThreadQueue.js';
import { EventDispatcher } from './EventDispatcher.js';
import { JobQueue } from '../utilities/JobQueue.js';

const USE_DITHERED_TRANSPARENCY = true;

/* globals SharedArrayBuffer */

// MeshLoader
// Loads and processes meshes from the server
export class MeshLoader extends EventDispatcher {

	static get shaderFunctions() {

		return {
			isDithered: /* glsl */`

				float isDithered( vec2 pos, float alpha ) {

					// Define a dither threshold matrix which can be used to define how
					// a 4x4 set of pixels will be dithered. Used to ensure transparent objects
					// can render to the depth buffer instead of rendering only at the end
					// of a full iterative render pass.
					float DITHER_THRESHOLDS[ 16 ];
					DITHER_THRESHOLDS[ 0 ] = 1.0 / 17.0;
					DITHER_THRESHOLDS[ 1 ] = 9.0 / 17.0;
					DITHER_THRESHOLDS[ 2 ] = 3.0 / 17.0;
					DITHER_THRESHOLDS[ 3 ] = 11.0 / 17.0;

					DITHER_THRESHOLDS[ 4 ] = 13.0 / 17.0;
					DITHER_THRESHOLDS[ 5 ] = 5.0 / 17.0;
					DITHER_THRESHOLDS[ 6 ] = 15.0 / 17.0;
					DITHER_THRESHOLDS[ 7 ] = 7.0 / 17.0;

					DITHER_THRESHOLDS[ 8 ] = 4.0 / 17.0;
					DITHER_THRESHOLDS[ 9 ] = 12.0 / 17.0;
					DITHER_THRESHOLDS[ 10 ] = 2.0 / 17.0;
					DITHER_THRESHOLDS[ 11 ] = 10.0 / 17.0;

					DITHER_THRESHOLDS[ 12 ] = 16.0 / 17.0;
					DITHER_THRESHOLDS[ 13 ] = 8.0 / 17.0;
					DITHER_THRESHOLDS[ 14 ] = 14.0 / 17.0;
					DITHER_THRESHOLDS[ 15 ] = 6.0 / 17.0;

					int modx = int( pos.x ) % 4;
					int mody = int( pos.y ) % 4;

					// array accessors must be constant, so we use a loop
					// here, which is unrolled with constant values
					int index = modx * 4 + mody;
					float thresh = DITHER_THRESHOLDS[ index ];
					return alpha - thresh;

				}
			`,
		};

	}

	static get vertexShader() {

		return /* glsl */`
			// Lighting
			struct DirLight {
				vec3 color;
				vec3 direction;
			};

			varying vec2 vUv;
			varying vec4 worldPos;
			varying vec3 vecNormal;

			uniform vec3 ambientLightColor;

			#if NUM_DIR_LIGHTS
			uniform DirLight directionalLights[NUM_DIR_LIGHTS];
			#endif

			attribute vec3 color; //vertex color
			varying vec3 outColor;

			uniform float _NormalDirection;
			uniform float _VertexColorMultiplier;

			void main() {

				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
				worldPos = modelMatrix * vec4( position, 1.0 );
				vecNormal = normalize( ( modelViewMatrix * vec4( normal, 0 ) ).xyz * _NormalDirection );

				outColor = ambientLightColor;

				#if NUM_DIR_LIGHTS
				for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {

					DirLight dl = directionalLights[ i ];
					outColor += clamp( dot( vecNormal, dl.direction ), 0.0, 1.0 ) * dl.color;

				}
				#endif

				outColor *= mix( vec3( 1, 1, 1 ), color, _VertexColorMultiplier ) / 3.1415926535;

			}
		`;

	}

	static get fragmentShader() {

		return /* glsl */`
			varying vec2 vUv;
			varying vec4 worldPos;
			varying vec3 vecNormal;
			varying vec3 outColor;

			uniform vec4 _Color;
			uniform vec3 _Emission;
			uniform bool PS_M_DITHER_TRANSPARENCY;
			uniform bool PS_M_CLIP;
			uniform vec3 _PSClipPlanePosition;
			uniform vec3 _PSClipPlaneNormal;

			${ this.shaderFunctions.isDithered }

			void main( void ) {

				if ( PS_M_DITHER_TRANSPARENCY && isDithered( gl_FragCoord.xy, _Color.a ) < 0.0 ) {

					discard;

				}

				// Discard if on the wrong side of the cut plane
				if ( PS_M_CLIP ) {

					vec3 planePointToWorldPos = worldPos.xyz - _PSClipPlanePosition;
					if ( dot( normalize( planePointToWorldPos ), normalize( _PSClipPlaneNormal ) ) < 0.0 ) {

						discard;

					}

				}

				vec4 res = _Color;
				res.rgb *= outColor;

				res.rgb += _Emission;
				gl_FragColor = res;

			}
		`;

	}

	// boosts the colors so they're not too dark. Based
	// on 'EnforceMinColor' function in 'ModelLoader.cs'
	// from the protospace repo
	static boostColor( c ) {

		let r = c.r,
			g = c.g,
			b = c.b,
			a = c.a;

		const max = Math.max( r, Math.max( g, b ) );

		const lmc = 40 / 255;
		const lma = 128 / 255;

		if ( max < lmc ) {

			if ( max === 0 ) r = g = b = lmc;
			else {

				const f = lmc / max;
				r = Math.min( r * f, 1 );
				g = Math.min( g * f, 1 );
				b = Math.min( b * f, 1 );

			}

		}

		if ( a < lma ) a = lma;

		return { r, g, b, a };

	}

	static _generateCustomShaderMaterial( color, side, depthOnly, ignoreVertexColors ) {

		if ( ! this.genericShaderMat ) {

			this.genericShaderMat = new THREE.ShaderMaterial( {
				name: 'Model Shader',
				uniforms: THREE.UniformsUtils.merge( [
					THREE.UniformsLib.lights,
					{
						PS_M_CLIP: { value: false },
						PS_M_DITHER_TRANSPARENCY: { value: false },
						_Color: { value: new THREE.Vector4( 0.0, 0.0, 0.0, 0.0 ) },
						_Emission: { value: new THREE.Vector3( 0.0, 0.0, 0.0 ) },
						_PSClipPlanePosition: { value: new THREE.Vector3( 0.0, 0.0, 0.0 ) },
						_PSClipPlaneNormal: { value: new THREE.Vector3( 0.0, 0.0, 0.0 ) },
						_NormalDirection: { value: 1 },
						_VertexColorMultiplier: { value: 1 },
					},
				] ),
				vertexShader: this.vertexShader,
				fragmentShader: this.fragmentShader,
				lights: true,
			} );

		}

		const newMat = this.genericShaderMat.clone();
		const linearColor = new THREE.Color( color.r, color.g, color.b ).convertSRGBToLinear()

		//these properties are added to the material only for the convience of other ProtoSpace code
		newMat.color = color;
		newMat.depthOnly = depthOnly;
		newMat.ignoreVertexColors = ignoreVertexColors;
		newMat.useAlpha = ! depthOnly && color.a < 1;

		//this flags the geometry as transparent so THREE.js will
		//* render it after opaque objects
		//* render it in back-to-front sorted order with other transparent objects
		//* alpha blend it
		//if we are using dithered transparency then we don't want any of that
		newMat.transparent = ! USE_DITHERED_TRANSPARENCY && newMat.useAlpha;

		newMat.uniforms = THREE.UniformsUtils.clone( this.genericShaderMat.uniforms );
		newMat.uniforms._Color.value = new THREE.Vector4( linearColor.r, linearColor.g, linearColor.b, color.a );

		newMat.uniforms.PS_M_DITHER_TRANSPARENCY.value = USE_DITHERED_TRANSPARENCY && newMat.useAlpha;
		newMat.uniforms._PSClipPlanePosition.value = new THREE.Vector3( 0.0, 0.0, 0.0 );
		newMat.uniforms._PSClipPlaneNormal.value = new THREE.Vector3( 0.0, 1.0, 0.0 );
		newMat.uniforms._VertexColorMultiplier.value = ignoreVertexColors ? 0 : 1;

		newMat.uniforms._NormalDirection.value = side === THREE.BackSide ? - 1 : 1;
		newMat.side = side;

		// newMat.setDepthWrite = true;
		// newMat.setDepthTest = true;

		newMat.colorWrite = ! depthOnly;

		return newMat;

	}

	//do not mutate returned material
	//instead use getMaterial() or getMaterialVariant() with different options
	static getMaterial( opts = {} ) {

		const color = opts.color || { r: 1, g: 1, b: 1, a: 1 };
		if ( ! ( 'a' in color ) ) color.a = 1;
		const side = 'side' in opts ? opts.side : THREE.FrontSide; //maybe opts.side === 0
		const depthOnly = !! opts.depthOnly;
		const ignoreVertexColors = !! opts.ignoreVertexColors;
		const unique = !! opts.unique;

		const r = color.r * 255,
			g = color.g * 255,
			b = color.b * 255,
			a = color.a * 255;
		const id = `${side}_${depthOnly}_${ignoreVertexColors}_${( a << 24 ) | ( b << 16 ) | ( g << 8 ) | r}`; //eslint-disable-line no-bitwise

		if ( ! unique && id in this.matCache ) return this.matCache[ id ];

		const mat = this._generateCustomShaderMaterial( MeshLoader.boostColor( color ), side, depthOnly, ignoreVertexColors );

		if ( ! unique ) this.matCache[ id ] = mat;

		return mat;

	}

	static getMaterialVariant( mat, opts = {} ) {

		return this.getMaterial( {
			color: opts.color || mat.color,
			side: 'side' in opts ? opts.side : mat.side,
			depthOnly: 'depthOnly' in opts ? opts.depthOnly : ! mat.colorWrite,
			ignoreVertexColors: 'ignoreVertexColors' in opts ? opts.ignoreVertexColors : !! mat.ignoreVertexColors,
			unique: !! opts.unique,
		} );

	}

	static get matCache() {

		return ( this._matCache = this._matCache || {} );

	}

	static get parsePLY() {

		// Make this a function because the threading class uses `toString()`,
		// and the function is printed as "parsePLY() {...}" otherwise, which
		// is an invalid function format
		return function ( data, swapYZ ) {

			/* eslint-disable no-var, vars-on-top, operator-assignment */
			// translated from ModelData.cs in ProtoSpace

			// using var instead of const and let and not using compound assignment
			// (+=, -=) because Chrome JIT was refusing to optimize this function
			// with those things

			var numVerts = 0;
			var numFaces = 0;
			var hasNormals = false;
			var hasColors = false;
			var hasIDs = false;
			var indexBytes = 4;

			var header = new TextDecoder( 'utf-8' ).decode( new Uint8Array( data, 0, Math.min( 1024, data.byteLength ) ) );
			if ( ! header.startsWith( 'ply' ) ) throw new Error( 'invalid PLY header' );

			//look for first instance of 'end_header' at the beginning of a line
			//must be at the beginning of a line to avoid detecting a comment line that mentions 'end_header'
			var endHeader = 'end_header';
			var headerEnd = 0;
			do {

				headerEnd = header.indexOf( endHeader, headerEnd );

			} while ( headerEnd > 0 && header[ headerEnd - 1 ] !== '\n' && header[ headerEnd - 1 ] !== '\r' );

			if ( headerEnd < 0 ) throw new Error( 'no end_header in PLY' );
			headerEnd = headerEnd + endHeader.length;
			if ( header[ headerEnd ] === '\r' ) ++ headerEnd;
			if ( header[ headerEnd ] === '\n' ) ++ headerEnd;

			header
				.substring( 0, headerEnd )
				.match( /[^\r\n]+/g )
				.forEach( line => {

					var chunks = line.split( ' ' );
					if ( chunks[ 0 ] === 'format' ) {

						if ( chunks[ 1 ] !== 'binary_little_endian' || chunks[ 2 ] !== '1.0' ) throw new Error( 'unexpected PLY format' );

					} else if ( chunks[ 0 ] === 'element' ) {

						if ( chunks[ 1 ] === 'vertex' ) numVerts = parseInt( chunks[ 2 ] );
						else if ( chunks[ 1 ] === 'face' ) numFaces = parseInt( chunks[ 2 ] );
						else throw new Error( 'unexpected PLY format' );

					} else if ( chunks[ 0 ] === 'property' ) {

						if ( chunks[ 2 ] === 'nx' ) hasNormals = true;
						else if ( chunks[ 2 ] === 'red' ) {

							if ( chunks[ 1 ] !== 'uchar' ) throw new Error( 'PLY vertex color must be in bytes' );
							hasColors = true;

						} else if ( chunks[ 2 ] === 'id' ) hasIDs = true;
						else if ( chunks.length === 5 && chunks[ 4 ] === 'vertex_index' ) {

							if ( chunks[ 3 ] === 'uint' || chunks[ 3 ] === 'int' ) indexBytes = 4;
							else if ( chunks[ 3 ] === 'ushort' ) indexBytes = 2;
							else if ( chunks[ 3 ] === 'uchar' ) indexBytes = 1;
							else throw new Error( 'Invalid face index type' );

						}

					} else if ( chunks[ 0 ] === 'comment' ) {
						/* ignore */
					}

				} );

			// console.log(`numVerts=${numVerts}, numFaces=${numFaces}, hasNormals=${hasNormals}, ` +
			//            `hasColors=${hasColors}, hasIDs=${hasIDs}`)

			// use a SharedArrayBuffer only if they're available
			var BufferType = typeof SharedArrayBuffer !== 'undefined' ? SharedArrayBuffer : ArrayBuffer;
			var vertices = new Float32Array( new BufferType( numVerts * 3 * 4 ) );
			var normals = hasNormals ? new Int8Array( new BufferType( numVerts * 3 ) ) : null;
			var colors = hasColors ? new Uint8Array( new BufferType( numVerts * 3 ) ) : null;

			// Figure out the optimal byte count needed to address all the
			// vertices in the vertex array. Uint8Array, Uint16Array, or Uint32Array.
			var indicesByteCount = 1;
			if ( vertices.length > 256 ) indicesByteCount = 2; // Math.pow(2, 8)
			if ( vertices.length > 65536 ) indicesByteCount = 4; // Math.pow(2, 16)

			var UintArrayType = null;
			switch ( indicesByteCount * 8 ) {

				case 8:
					UintArrayType = Uint8Array;
					break;
				case 16:
					UintArrayType = Uint16Array;
					break;
				case 32:
					UintArrayType = Uint32Array;
					break;

			}

			var indices = new UintArrayType( new BufferType( numFaces * 3 * indicesByteCount ) );

			// var ids = hasIDs ? new Int32Array(numFaces) : null

			var dv = new DataView( data, headerEnd );

			// value for converting a float between -1 to 1 to
			// an 8 bit int. This is to save memory on the normals
			// Math.pow(2, 7) - 1
			var normFloatToInt8 = 127;

			var readIndex;
			if ( indexBytes == 4 ) readIndex = ( idx, endian ) => dv.getUint32( idx, endian );
			else if ( indexBytes == 2 ) readIndex = ( idx, endian ) => dv.getUint16( idx, endian );
			else if ( indexBytes == 1 ) readIndex = ( idx, endian ) => dv.getUint8( idx, endian );
			else throw new Error( 'Invalid value of indexBytes' );

			var i = 0;
			var j = 0;
			var k = 0;
			var vi = 0;
			var ni = 0;
			var ci = 0;
			var fi = 0;
			var swap = swapYZ ? [ 0, 2, 1 ] : [ 0, 1, 2 ];
			for ( i = 0; i < numVerts; i ++ ) {

				for ( k = 0; k < 3; k ++, j = j + 4 ) vertices[ 3 * vi + swap[ k ] ] = dv.getFloat32( j, true );
				vi ++;
				if ( hasNormals ) {

					for ( k = 0; k < 3; k ++, j = j + 4 ) normals[ 3 * ni + swap[ k ] ] = dv.getFloat32( j, true ) * normFloatToInt8;
					ni ++;

				}

				if ( hasColors ) {

					for ( k = 0; k < 3; k ++, j ++ ) colors[ 3 * ci + k ] = dv.getUint8( j );
					ci ++;

				}

			}

			swap = swapYZ ? [ 2, 1, 0 ] : [ 0, 1, 2 ];
			var skippedFaces = 0;
			for ( i = 0; i < numFaces; i ++ ) {

				var sz = dv.getUint8( j ++ );
				if ( sz !== 3 ) {

					j = j + sz * indexBytes; // skip non-triangle face
					if ( hasIDs ) j = j + 4;
					skippedFaces ++;

				} else {

					for ( k = 0; k < sz; k ++, j += indexBytes ) indices[ 3 * fi + swap[ k ] ] = readIndex( j, true );
					if ( hasIDs ) j = j + 4;
					fi ++;

				}

			}

			if ( skippedFaces > 0 ) {

				numFaces = numFaces - skippedFaces;
				indices = indices.subarray( 0, 3 * numFaces );

			}

			return { indices, vertices, normals, colors };

			/* eslint-enable no-var, vars-on-top, operator-assignment */

		};

	}

	static usingThreads() {

		return typeof Worker !== 'undefined' && typeof SharedArrayBuffer !== 'undefined';

	}

	static get loadQueue() {

		if ( ! this._loadQueue ) {

			// make parsePLY accessible with the same syntax whether loadFunc() is run in a web worker or the main thread
			const parsePLY = this.parsePLY;

			function loadFunc( inp ) {

				const { archiveData, size, isLZF, baseOffset, swapYZ } = inp;
				const data = new Uint8Array( archiveData, baseOffset, size );
				return parsePLY( isLZF ? window.LZF.decompress( data ) : data, swapYZ );

			}

			if ( this.usingThreads() ) {

				const numThreads = 10;
				console.log( `MeshLoader using ${numThreads} threads` );
				this._loadQueue = new ThreadQueue( //eslint-disable-line new-cap
					numThreads,
					loadFunc,
					{
						// context for running loadFunc
						window: {}, // needed so that lzf can set itself up as window.LZF
						parsePLY, // this will stringify parsePLY() to define it in the web worker thread
					},
					[ '/src/lib/lzf.js' ], // extra sources to evaluate in thread
					{ initializeImmediately: true }
				);

			} else {

				console.warn(
					'MeshLoader threading disabled, possibly due to https://www.chromium.org/Home/chromium-security/ssca'
				);
				// emulate the threading-js api here so other code doesn't have to change
				const jq = new JobQueue();
				this._loadQueue = { run: inp => jq.run( () => loadFunc( inp ) ) };

			}

		}

		return this._loadQueue;

	}

	/* Life Cycle Functions */
	constructor( modelURL, extraFetchOptions = {} ) {

		super();
		this.resetForNewLoad();
		this._modelURL = modelURL;
		Object.assign( this._fetchOptions, extraFetchOptions );

	}

	/* Public API */
	resetForNewLoad() {

		this._modelURL = '';
		this._fetchOptions = { credentials: 'same-origin', mode: 'cors' };
		this._cache = {};
		this._funcCache = {};
		this._matCache = {};
		this._archives = {};

		this._pendingLoads = [];
		this._loadTimeout = null;

		this._loadsProcessed = 0;
		this._totalLoaded = 0;
		this._totalQueued = 0;
		this._startTime = new Date();

	}

	/* Public API */
	fetchGeometry( name, archive, swapYZ, func ) {

		if ( ! ( archive in this._cache ) ) this._cache[ archive ] = {};

		if ( name in this._cache[ archive ] ) {

			//load has already started (or maybe already completed) for this mesh

			if ( this._cache[ archive ][ name ] !== null ) func( this._cache[ archive ][ name ] );
			//already completed
			else this._funcCache[ name ].push( func ); //load already started but not completed

			return;

		}

		//get here iff this is the first request for this mesh, so launch a load for it
		this._cache[ archive ][ name ] = null;
		this._funcCache[ name ] = [ func ];

		this.fetchPLY( name, archive, ( inp, done ) => {

			MeshLoader.loadQueue.run( Object.assign( { swapYZ }, inp ) ).then( res => {

				const { vertices, indices, normals, colors } = res;

				const geometry = new THREE.BufferGeometry();
				geometry.setIndex( new THREE.BufferAttribute( indices, 1 ) );
				geometry.setAttribute( 'position', new THREE.BufferAttribute( vertices, 3 ) );
				if ( normals ) geometry.setAttribute( 'normal', new THREE.BufferAttribute( normals, 3, true ) );
				else {

					geometry.computeVertexNormals();
					console.log( `generated vertex normals for ${archive}/${name}` );

				}

				if ( colors ) geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3, true ) );

				geometry.computeBoundingSphere();

				this._cache[ archive ][ name ] = geometry;

				for ( const f of this._funcCache[ name ] ) f( geometry );

				delete this._funcCache[ name ];

				done();

			} );

		} );

	}

	/* Private Functions */
	processLoads() {

		this._startTime = new Date();

		for ( let i = this._loadsProcessed; i < this._totalQueued; i ++ ) {

			const load = this._pendingLoads[ i ];
			const archive = this._archives[ load.archive ];

			if ( ! archive.loaded ) break;

			if ( load.name + '.lzf' in archive.entries ) {

				const entry = archive.entries[ load.name + '.lzf' ];
				load.func(
					{ isLZF: true, archiveData: archive.data, baseOffset: entry.base_offset, size: entry.size },
					() => this._totalLoaded ++
				);

			} else if ( load.name in archive.entries ) {

				const entry = archive.entries[ load.name ];
				load.func(
					{ archiveData: archive.data, baseOffset: entry.base_offset, size: entry.size },
					() => this._totalLoaded ++
				);

			} else {

				console.log( `unable to load mesh ${load.name}, not found in archive ${load.archive}` );
				this._totalLoaded ++;

			}

			this._loadsProcessed ++;

			if ( new Date() - this._startTime > 15 ) break;

		}

		const totalMS = new Date() - this._startTime;

		if ( this._totalQueued > this._totalLoaded ) {

			if ( totalMS > 500 ) {

				//console.log(`throttling mesh loads, continuing after delay`)
				this._loadTimeout = setTimeout( () => this.processLoads(), 1000 );

			} else {

				//console.log(`continuing mesh loads after yield`)
				this._loadTimeout = requestAnimationFrame( () => this.processLoads() );

			}

		} else {

			this._pendingLoads = [];
			this._loadTimeout = null;

		}

	}

	fetchPLY( name, archive, func ) {

		// fetch archive files if necessary
		if ( ! ( archive in this._archives ) ) {

			console.log( `Fetching model archive: ${archive}` );
			this._archives[ archive ] = {
				loaded: false, // becomes true only when both bin and json are loaded
				entries: null, // json index
				data: null, // binary data
			};

			// fetch the json index for the archive
			fetch( `${this._modelURL}/${archive}.json`, this._fetchOptions )
				.then( res => {

					if ( ! res.ok ) throw new Error( `error fetching model archive index: ${res.status} (${res.statusText})` );
					return res.json();

				} )
				.then( entries => {

					this._archives[ archive ].entries = entries;
					this._archives[ archive ].loaded = this._archives[ archive ].data !== null; //has the bin also been loaded?

				} );

			// fetch the binary data for the archive
			// and dispatch download progress events
			fetch( `${this._modelURL}/${archive}.bin`, this._fetchOptions )
				.then( res => {

					// Fallback for browsers that have not yet implemented ReadableStream, skip reporting download progress
					// see: https://caniuse.com/#feat=streams
					if ( ! window.ReadableStream ) return res;

					const contentLength = res.headers.get( 'content-length' );
					if ( ! contentLength ) {

						throw Error( 'Content-Length response header unavailable' );

					}

					const total = parseInt( contentLength, 10 );
					let loaded = 0;
					const _context = this;
					return new Response(
						new ReadableStream( {
							start( controller ) {

								const reader = res.body.getReader();
								const read = () => {

									reader
										.read()
										.then( ( { done, value } ) => {

											if ( done ) {

												controller.close();
												return;

											}

											loaded += value.byteLength;
											_context._dispatch( 'model-binary-download-progress', {
												archive,
												loaded,
												total,
											} );

											controller.enqueue( value );
											read();

										} )
										.catch( error => {

											console.error( error );
											controller.error( error );

										} );

								};

								read();

							},
						} )
					);

				} )
				.then( res => {

					if ( ! res.ok ) throw new Error( `error fetching model archive data: ${res.status} (${res.statusText})` );
					return res.arrayBuffer();

				} )
				.then( data => {

					console.log( `Done fetching model archive: ${archive}` );
					if ( MeshLoader.usingThreads() ) {

						const sab = new SharedArrayBuffer( data.byteLength );
						new Uint8Array( sab ).set( new Uint8Array( data ) );
						data = sab;

					}

					this._archives[ archive ].data = data;
					this._archives[ archive ].loaded = this._archives[ archive ].entries !== null; //has the json also been loaded?

				} );

		}

		this._pendingLoads.push( { name, archive, func } );

		this._totalQueued ++;

		if ( ! this._loadTimeout ) this._loadTimeout = setTimeout( () => this.processLoads(), 100 );

	}

}
