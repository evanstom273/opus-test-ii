// Sky dome: a vertical gradient that meets the fog colour at the horizon.
import * as THREE from 'three';

export const HORIZON = 0xb9d7f2;
const ZENITH = 0x5d9be3;

const rgb = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);

export class Sky {
  constructor(scene) {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uHorizon: { value: rgb(HORIZON) }, uZenith: { value: rgb(ZENITH) } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      // Colours are given and output in sRGB, matching how the fog is blended.
      fragmentShader: /* glsl */ `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        varying vec3 vDir;
        void main() {
          float t = max(normalize(vDir).y, 0.0);
          gl_FragColor = vec4(mix(uHorizon, uZenith, pow(t, 0.55)), 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // Keep the dome centred on the camera and inside its far plane.
  update(camera) {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }
}
