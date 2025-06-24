import * as THREE from 'three';

/**
 * Shared utilities for clipping plane functionality
 */
export class ClipPlaneUtilities {
	
	/**
	 * Get the uniforms needed for clipping plane support
	 * @returns {Object} Uniforms object with clipping plane properties
	 */
	static getClipPlaneUniforms() {
		return {
			PS_M_CLIP: { value: false },
			_PSClipPlanePosition: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
			_PSClipPlaneNormal: { value: new THREE.Vector3(0.0, 0.0, 0.0) },
		};
	}

	/**
	 * Get the GLSL uniform declarations for clipping plane support
	 * @returns {string} GLSL uniform declarations
	 */
	static getClipPlaneUniformDeclarations() {
		return /* glsl */`
			uniform bool PS_M_CLIP;
			uniform vec3 _PSClipPlanePosition;
			uniform vec3 _PSClipPlaneNormal;
		`;
	}

	/**
	 * Get the GLSL fragment shader code for clipping plane support
	 * @returns {string} GLSL code to be included in fragment shaders
	 */
	static getClipPlaneFragmentShader() {
		return /* glsl */`
			// Discard if on the wrong side of the cut plane
			if (PS_M_CLIP) {
				vec3 planePointToWorldPos = worldPos.xyz - _PSClipPlanePosition;
				if (dot(normalize(planePointToWorldPos), normalize(_PSClipPlaneNormal)) < 0.0) {
					discard;
				}
			}
		`;
	}

	/**
	 * Create a highlight material with clipping plane support
	 * @param {Object} color - Color object with r, g, b properties (0-1 range)
	 * @param {number} opacity - Opacity value (0-1 range)
	 * @returns {THREE.ShaderMaterial} Highlight material with clipping plane support
	 */
	static createHighlightMaterial(color, opacity) {
		return new THREE.ShaderMaterial({
			name: 'Highlight Shader',
			uniforms: THREE.UniformsUtils.merge([
				THREE.UniformsLib.lights,
				{
					...this.getClipPlaneUniforms(),
					_Color: { value: new THREE.Vector4(color.r, color.g, color.b, opacity) },
				}
			]),
			vertexShader: /* glsl */`
				varying vec4 worldPos;

				void main() {
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
					worldPos = modelMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */`
				varying vec4 worldPos;

				uniform vec4 _Color;
				${this.getClipPlaneUniformDeclarations()}

				void main() {
					${this.getClipPlaneFragmentShader()}

					gl_FragColor = _Color;
				}
			`,
			transparent: true,
			depthTest: false,
			lights: false,
		});
	}
}
