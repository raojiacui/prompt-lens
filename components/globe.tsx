"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });
  const targetRotation = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 500;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Create globe
    const globeGeometry = new THREE.SphereGeometry(180, 64, 64);

    // Custom shader for wireframe globe
    const globeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color("#D97757") },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float time;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
          // Create grid pattern
          float lat = vPosition.y / 180.0;
          float lon = atan(vPosition.x, vPosition.z) / 3.14159;

          float gridX = abs(sin(lon * 20.0));
          float gridY = abs(sin(lat * 20.0));

          float grid = max(step(0.95, gridX), step(0.95, gridY));

          // Gradient based on position
          float gradient = 0.3 + 0.7 * (vPosition.y / 180.0 + 0.5);

          vec3 finalColor = color * gradient;
          float alpha = 0.15 + grid * 0.4;

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    scene.add(globe);
    globeRef.current = globe;

    // Add glowing ring (orbital rings like Anthropic)
    const ringGeometry = new THREE.TorusGeometry(220, 2, 16, 100);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: "#D97757",
      transparent: true,
      opacity: 0.3,
    });

    const ring1 = new THREE.Mesh(ringGeometry, ringMaterial);
    ring1.rotation.x = Math.PI / 2;
    ring1.scale.set(1, 0.3, 1);
    scene.add(ring1);

    const ring2 = new THREE.Mesh(ringGeometry.clone(), ringMaterial.clone());
    ring2.rotation.x = Math.PI / 2;
    ring2.rotation.z = Math.PI / 4;
    ring2.scale.set(1.2, 0.25, 1);
    scene.add(ring2);

    const ring3 = new THREE.Mesh(ringGeometry.clone(), ringMaterial.clone());
    ring3.rotation.x = Math.PI / 2;
    ring3.rotation.z = -Math.PI / 4;
    ring3.scale.set(1.4, 0.2, 1);
    scene.add(ring3);

    // Mouse controls
    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      targetRotation.current.y += deltaX * 0.005;
      targetRotation.current.x += deltaY * 0.005;

      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging.current = false;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isDragging.current = true;
        previousMousePosition.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging.current || e.touches.length !== 1) return;

      const deltaX = e.touches[0].clientX - previousMousePosition.current.x;
      const deltaY = e.touches[0].clientY - previousMousePosition.current.y;

      targetRotation.current.y += deltaX * 0.005;
      targetRotation.current.x += deltaY * 0.005;

      previousMousePosition.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    };

    const onTouchEnd = () => {
      isDragging.current = false;
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    // Animation
    let animationId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();

      // Smooth rotation
      if (globe) {
        globe.rotation.y += (targetRotation.current.y - globe.rotation.y) * 0.1;
        globe.rotation.x += (targetRotation.current.x - globe.rotation.x) * 0.1;
      }

      // Auto-rotate rings
      if (ring1) ring1.rotation.z = elapsed * 0.1;
      if (ring2) ring2.rotation.z = elapsed * 0.08 + Math.PI / 4;
      if (ring3) ring3.rotation.z = elapsed * 0.06 - Math.PI / 4;

      renderer.render(scene, camera);
    };

    animate();

    // Handle resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);

      if (containerRef.current && renderer.domElement) {
        containerRef.current.removeChild(renderer.domElement);
      }

      globeGeometry.dispose();
      globeMaterial.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-0"
      style={{ cursor: "grab" }}
    />
  );
}