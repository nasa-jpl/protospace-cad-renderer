import * as THREE from 'three';
import { RenderLayer } from './RenderLayer.js';
import { MeshPool } from './MeshPool.js';
import { MeshLoader } from '../model/MeshLoader.js';
import { CombinedCamera } from '../lib/CombinedCamera.js';

/* Render Layer for rending models nodes over multiple frames */
export class ModelRenderLayer extends RenderLayer {

	*_taskFunction() {

		let rendered = 0;
		let renderedTriangles = 0;

		const addPooledMesh = ( mi, geom, mat ) => {

			if ( mat && mat.uniforms && mat.uniforms.PS_M_CLIP ) {

				if ( this.clipPlane ) {

					const { point, normal } = this.clipPlane;
					mat.uniforms._PSClipPlanePosition.value = point;
					mat.uniforms._PSClipPlaneNormal.value = normal;
					mat.uniforms.PS_M_CLIP.value = true;

				} else {

					mat.uniforms.PS_M_CLIP.value = false;

				}

			}

			const mesh = MeshPool.allocate();
			mesh.geometry = geom;
			mesh.material = mat;
			mesh.matrix = mi.cached.meshToModel;
			mesh.visible = true;
			mesh.renderOrder = mat.depthOnly ? 0 : 1;

			// disable frustum culling on the object to avoid the
			// small amount of overhead incurred
			// TODO: is this really a good idea?
			mesh.frustumCulled = false;

			this.modelFrame.add( mesh );
			mesh.updateMatrixWorld( true );

		};

		let i = 0;
		while ( true ) {

			const n = this.getNodeToRender( this.model, i ++ );
			if ( ! n ) break;
			if ( ! n.geometry || ! n.geometry.length ) continue;

			if ( n.cached.transformDirty ) this.model.refreshTransforms( n.id, false );

			for ( let g = 0; g < n.geometry.length; g ++ ) {

				const mi = n.geometry[ g ];
				if ( ! mi.cached.triangles || ! mi.cached.threejsGeometry ) continue;

				const geom = mi.cached.threejsGeometry;
				const mat = this.getMaterial( n, mi );

				if ( Array.isArray( mat ) ) mat.forEach( m => addPooledMesh( mi, geom, m ) );
				else addPooledMesh( mi, geom, mat );

				// TODO: This will cause a flicker on load because every time
				// we start again, there will be new geometry available which
				// means we won't get as far into the array the next round
				rendered ++;
				renderedTriangles += mi.cached.triangles;

				if ( renderedTriangles >= this.triangleLimit || rendered >= this.geometryLimit ) {

					yield null;
					rendered = 0;
					renderedTriangles = 0;

				}

			}

		}

	}

	/* Lifecycle Functions */
	constructor( model, zindex = 0, name = 'model render layer' ) {

		super( zindex, name );
		this._task = null;
		this._renderComplete = false;

		// render settings
		this.clearColor = 0x000000;
		this.clearAlpha = 0;
		this.targetScale = 1;
		this.depthTexture = null;
		this.triangleLimit = 250000; // how many triangles to render
		this.geometryLimit = 1000; // how many meshes to render
		this.clipPlane = null; //this gets poked by ps-viewer.js

		this.model = model;
		this.modelToWorld = new THREE.Matrix4(); //this gets poked by ps-viewer.js

		// scene setup
		this.modelFrame = new THREE.Object3D();
		this.modelFrame.matrixAutoUpdate = false;

		// disabling the scene autoUpdate can cause a render
		// to take an extra millisecond. However, disabling it
		// means that the camera doesn't get auto-updated, so we
		// update it manually below
		this.scene = new THREE.Scene();
		this.scene.matrixWorldAutoUpdate = false;

		this.camera = new CombinedCamera( window.innerWidth, window.innerHeight, 75, 0.1, 1000 );
		this.camera.position.z = 5;

		this.scene.add( this.camera );
		this.scene.add( this.modelFrame );

	}

	/* Public API */
	redraw() {

		this._task = null;
		this._renderComplete = false;

	}

	/* Interface */
	getMaterial( n, mi ) {

		//in the case of a double sided mesh we actually render it twice, once for each side
		//because that way our shader uses the correct normal direction for each side
		const mat = mi.cached.threejsMaterial;
		if ( mat.side !== THREE.DoubleSide ) return mat;
		return [
			MeshLoader.getMaterialVariant( mat, { side: THREE.FrontSide } ),
			MeshLoader.getMaterialVariant( mat, { side: THREE.BackSide } ),
		];

	}

	// this is an overrideable hook to accomodate lists of nodes
	// that are generated as-needed, as in the case with highlighted nodes.
	getNodeToRender( model, i ) {

		return model.sortedVisibleNodes[ i ];

	}

	prerender() {}

	postrender() {}

	needsToDraw() {

		return this._task === null || ! this._renderComplete;

	}

	render( renderer, target, viewWidth, viewHeight ) {

		target.depthTexture = this.depthTexture;
		target.setSize( viewWidth * this.targetScale, viewHeight * this.targetScale );

		this.prerender( renderer, target, viewWidth, viewHeight );

		// Update the camera and matrix manually because we
		// disable the scene autoUpdate above
		this.camera.setSize( viewWidth, viewHeight );
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld( true );

		this.modelFrame.matrix.copy( this.modelToWorld );
		this.modelFrame.updateMatrixWorld( true );

		renderer.autoClear = false;

		// If the task doesn't exist, then restart it
		if ( this._task === null ) {

			this._task = this._taskFunction();

			// Clear the target if this is the first render
			// and we're restarting the task
			renderer.autoClear = true;
			renderer.setClearColor( this.clearColor, this.clearAlpha );
			renderer.setRenderTarget( target );
			renderer.clear( true, true, true );
			renderer.setRenderTarget( null );

		}

		//the model geometries are already sorted such that
		//* depth-only nodes come first
		//* transparent nodes come last
		//* larger nodes come before smaller
		//TODO if we're using alpha blended transparency
		//i.e. if (a) there are any transparent nodes and (b) !config.renderer.useDitheredTransparency
		//then those should be dynamically sorted back to front according to the current viewpoint
		this.sortedRender = false;
		const res = this._task.next();
		this._renderComplete = res.done;

		renderer.sortObjects = this.sortedRender;
		this.camera.setSize( target.width, target.height );
		renderer.sortObjects = true; //restore default

		renderer.setRenderTarget( target );
		renderer.render( this.scene, this.camera );
		renderer.setRenderTarget( null );

		MeshPool.releaseAll( m => {

			m.frustumCulled = true;

		} );

		this.postrender( renderer, target, viewWidth, viewHeight );

		target.depthTexture = null;

	}

}
