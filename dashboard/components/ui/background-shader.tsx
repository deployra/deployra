'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function BackgroundShader() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Skip if running on server or container not available
    if (typeof window === 'undefined' || !containerRef.current) return;

    // Load Three.js if not already loaded
    const loadThreeJs = async () => {
      // Create scene, camera and renderer
      const scene = new THREE.Scene();
      const camera = new THREE.Camera();
      const renderer = new THREE.WebGLRenderer({ alpha: true });
      
      const container = containerRef.current;
      if (!container) return; // Early return if container is null
      
      const { width, height } = container.getBoundingClientRect();
      
      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);

      // Shader uniforms
      const uniforms = {
        uTime: { value: 0.0 },
        uResolution: { value: new THREE.Vector2(width, height) }
      };

      // Vertex shader
      const vertexShader = `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `;

      // Fragment shader
      const fragmentShader = `
        precision highp float;

        uniform float uTime;
        uniform vec2 uResolution;

        varying vec2 vUv;

        float noise(vec2 p) {
          return sin(p.x * 10.0) * sin(p.y * 10.0);
        }

        void main() {
          vec2 st = gl_FragCoord.xy / uResolution.xy;
          vec2 pos = st * 3.0;

          float color = 0.0;
          color += sin(pos.x * 2.0 + uTime * 0.3);
          color += sin(pos.y * 3.0 + uTime * 0.5);
          color += sin((pos.x + pos.y) * 4.0 + uTime * 0.7);
          color = color / 3.0;

          // Blue color transition
          vec3 darkBlue = vec3(0.02, 0.05, 0.2);      // Deep night blue
          vec3 neonBlue = vec3(0.2, 0.6, 1.0);        // Neon blue
          vec3 finalColor = mix(darkBlue, neonBlue, color);
          gl_FragColor = vec4(finalColor, 1.0);
        }
      `;

      // Create material with shaders
      const material = new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true
      });

      // Create geometry and mesh
      const geometry = new THREE.PlaneGeometry(2, 2);
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Animation clock
      const clock = new THREE.Clock();

      // Animation loop
      function animate() {
        uniforms.uTime.value = clock.getElapsedTime();
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }

      // Start animation
      animate();

      // Handle resize
      const handleResize = () => {
        if (!containerRef.current) return;
        
        const { width, height } = containerRef.current.getBoundingClientRect();
        renderer.setSize(width, height);
        uniforms.uResolution.value.set(width, height);
      };

      window.addEventListener('resize', handleResize);

      // Cleanup
      return () => {
        if (container && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        window.removeEventListener('resize', handleResize);
        geometry.dispose();
        material.dispose();
      };
    };

    loadThreeJs();
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="absolute inset-0 -z-10 overflow-hidden"
      aria-hidden="true"
    />
  );
}
