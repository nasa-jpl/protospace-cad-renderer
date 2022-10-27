// FBXLoader requires that THREE js be on the window
import '../lib/three.window.js';
import '../lib/FBXLoader.js';
import '../lib/CombinedCamera.js';

import * as THREE from '/node_modules/three/build/three.module.js';
import RenderLayer from './RenderLayer.js';
import MeshLoader from '../model/MeshLoader.js';

const CombinedCamera = window.THREE.CombinedCamera;

/* Render Layer for rendering annotations on the 3D scene */
export default class AnnotationRenderLayer extends RenderLayer {

	get vertexShader() {

		return `
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

      varying vec3 lightColor;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        worldPos = vec4(position,1.0);
        vecNormal = normalize((modelViewMatrix * vec4(normal, 0)).xyz);

        lightColor = ambientLightColor;

        #if NUM_DIR_LIGHTS
        for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
            DirLight dl = directionalLights[i];
            lightColor += clamp(dot(vecNormal, dl.direction), 0.0, 1.0) * dl.color;
        }
        #endif
      }`;

	}

	get fragmentShader() {

		return `
    varying vec2 vUv;
    varying vec4 worldPos;
    varying vec3 vecNormal;
    varying vec3 lightColor;

    uniform vec4 _Color;
    uniform sampler2D _DepthTexture;
    uniform float _DrawThroughAlpha;

    uniform bool _UseOptionalTexture;
    uniform sampler2D _OptionalTexture;
    uniform int _DepthTexWidth;
    uniform int _DepthTexHeight;

    ${MeshLoader.shaderFunctions.isDithered}

    void main(void)
    {
      float widthFraction = gl_FragCoord.x / float(_DepthTexWidth);
      float heightFraction = gl_FragCoord.y / float(_DepthTexHeight);

      float unscaledColorLayerDepth = texture2D(_DepthTexture, vec2(widthFraction, heightFraction)).x;
      if (gl_FragCoord.z > unscaledColorLayerDepth) {
        if(isDithered(gl_FragCoord.xy, _DrawThroughAlpha) < 0.0) discard;
      }

      vec4 res;

      if (_UseOptionalTexture) {
        res = texture2D(_OptionalTexture, vUv);
      } else {
        res = _Color;
      }

      res.rgb *= lightColor;
      gl_FragColor = res;
    }`;

	}

	get fbxLoader() {

		if ( ! this._fbxLoader ) {

			const manager = new THREE.LoadingManager();
			const fbxManager = new window.THREE.FBXLoader( manager );

			const onProgress = () => {};

			this._fbxLoader = {
				load: path =>
					new Promise( ( resolve, reject ) => {

						fbxManager.load( path, obj => resolve( obj ), onProgress, err => {

							console.error( err );
							reject( err );

						} );

					} ),
			};

		}

		return this._fbxLoader;

	}

	get genericShaderMat() {

		if ( ! this._genericShaderMat ) {

			this._genericShaderMat = new THREE.ShaderMaterial( {
				name: 'Model Shader',
				uniforms: THREE.UniformsUtils.merge( [
					THREE.UniformsLib.lights,
					{
						_Color: { type: 'v4', value: new THREE.Vector4( 0.0, 0.0, 0.0, 0.0 ) },
						_DepthTexture: { value: new THREE.DepthTexture() },
						_DepthTexWidth: { type: 'i', value: 0 },
						_DepthTexHeight: { type: 'i', value: 0 },
						_DrawThroughAlpha: { type: 'f', value: 0.0 },
					},
				] ),
				vertexShader: this.vertexShader,
				fragmentShader: this.fragmentShader,
				transparent: true,
				lights: true,
			} );

		}

		return this._genericShaderMat;

	}

	/* Lifecycle Functions */
	constructor( zindex = 0, name = 'annotation render layer' ) {

		super( zindex, name );

		//these get poked from session-viewer-app.js
		this.annotationState = {
			poi: {
				hide: true,
				pos: new THREE.Vector3(),
				norm: new THREE.Vector3( 0, 1, 0 ),
			}
		};
		this.model = null;

		//this gets poked from ps-viewer.js
		this.modelToWorld = new THREE.Matrix4();

		this.workspaceFrame = new THREE.Object3D();
		this.workspaceFrame.name = 'WorkspaceFrame';
		this.workspaceFrame.matrixAutoUpdate = false;

		this.modelFrame = new THREE.Object3D();
		this.modelFrame.name = 'ModelFrame';
		this.modelFrame.matrixAutoUpdate = false;

		this.scene = new THREE.Scene();

		this.camera = new CombinedCamera( window.innerWidth, window.innerHeight, 75, 0.1, 1000 );
		this.camera.position.z = 5;

		this.scene.add( this.camera );
		this.scene.add( this.workspaceFrame );
		this.scene.add( this.modelFrame );

		// render settings
		this.clearColor = 0x000000;
		this.clearAlpha = 0;
		this.targetScale = 1;
		this.depthTexture = null;

		// load models
		this.poiScale = 0.01;
		this._loadPoiModel();
		this.animationClock = new THREE.Clock();

	}

	/* Utilities */
	_recursiveAssignMaterial( mat, node ) {

		if ( node.geometry ) node.material = mat;
		node.children.forEach( child => this._recursiveAssignMaterial( mat, child ) );

	}

	/* Private API */
	_getMaterial( r, g, b, a ) {

		const newMat = this.genericShaderMat.clone();

		// these values are needed for the visibility culler
		newMat.uniforms = THREE.UniformsUtils.clone( this.genericShaderMat.uniforms );
		newMat.uniforms._Color.value = new THREE.Vector4( r, g, b, a );

		return newMat;

	}

	_loadPoiModel() {

		this.fbxLoader.load( '/models/poi_animated.fbx' ).then( model => {

			this.poiObject = model;
			this.poiObject.add( new THREE.DirectionalLight( 0xffffff, 0.75 ) );
			this.poiMat = this._getMaterial( 1, 1, 1, 1.0 );
			this.poiMat.uniforms._DrawThroughAlpha.value = 0.25;

			this.poiAnimationMixer = new THREE.AnimationMixer( this.poiObject );

			const action = this.poiAnimationMixer.clipAction( this.poiObject.animations[ 0 ] );
			action.setDuration( 8 );
			action.play();

			this.poiRoot = new THREE.Object3D();
			this.poiRoot.add( this.poiObject );
			this.modelFrame.add( this.poiRoot );

			this.poiObject.traverse( child => {

				if ( child instanceof THREE.Mesh ) child.material = this.poiMat;

			} );

		} );

	}

	_updatePoi() {

		window.annotation = this;

		if ( ! this.poiObject || ! this.annotationState.poi ) return;

		const poi = this.annotationState.poi;

		if ( poi.hide ) {

			this.poiObject.visible = false;
			return;

		}

		this.poiObject.visible = true;
		this.poiAnimationMixer.update( this.animationClock.getDelta() );

		const q = new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), new THREE.Vector3().copy( poi.norm ) );

		//compensate for model scale so that the POI model always appears the same size on screen
		//it wouldn't work to just keep modelToWorld scale identity
		//because we need the model scale factor to apply to the POI position
		const s = this.poiScale / this.modelToWorld.getMaxScaleOnAxis();
		this.poiObject.scale.set( s, s, s );

		if ( this.poiRoot.position.equals( poi.pos ) && this.poiRoot.quaternion.equals( q ) ) return;

		this.poiRoot.position.copy( poi.pos );
		this.poiRoot.quaternion.copy( q );

	}

	_updateWorkspaceAndModelFrame() {

		//Note 1: modelFrame is not actually parented to workspaceFrame.
		//Note 2: the model is rendered separately by ModelRenderLayer which maintains its own version of modelFrame.

		this.workspaceFrame.matrix.identity();
		this.modelFrame.matrix.copy( this.modelToWorld );

		//compute matrixWorld from matrix (matrixAutoUpdate is off)
		//updateMatrixWorld() is recursive, it operates on the node and all descendants
		//(so if modelFrame was parented to workspaceFrame then it would only be needed to call this on the latter)
		//the descendants of workspaceFrame are the floor plane
		//the only descendant of modelFrame is the POI
		this.workspaceFrame.updateMatrixWorld( true );
		this.modelFrame.updateMatrixWorld( true );

	}

	/* Interface */
	prerender() {}

	postrender() {}

	needsToDraw() {

		return true;

	}

	render( renderer, target, viewWidth, viewHeight ) {

		target.setSize( viewWidth * this.targetScale, viewHeight * this.targetScale );

		// Material Updates
		const updateMaterial = mat => {

			mat.uniforms._DepthTexture.value = this.depthTexture;
			mat.uniforms._DepthTexWidth.value = this.depthTexture.image.width;
			mat.uniforms._DepthTexHeight.value = this.depthTexture.image.height;

		};

		if ( this.poiMat ) updateMaterial( this.poiMat );

		this.prerender( renderer, target, viewWidth, viewHeight );

		// Camera Updates
		this.camera.setSize( viewWidth, viewHeight );

		// Transform Updates
		this._updateWorkspaceAndModelFrame();
		this._updatePoi();

		// Rendering
		renderer.setClearColor( this.clearColor, this.clearAlpha );
		renderer.clearTarget( target, true, true, true );
		renderer.render( this.scene, this.camera, target );

		this.postrender( renderer, target, viewWidth, viewHeight );

	}

}
