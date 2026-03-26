"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const globeRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const isDragging = useRef(false);
  const previousMousePosition = useRef({ x: 0, y: 0 });
  const targetRotation = useRef({ x: 0, y: 0 });
  const targetZoom = useRef(1);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.z = 500;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const globeGeometry = new THREE.SphereGeometry(180, 128, 128);

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
          float lat = vPosition.y / 180.0;
          float lon = atan(vPosition.x, vPosition.z) / 3.14159;

          float gridX = abs(sin(lon * 30.0));
          float gridY = abs(sin(lat * 30.0));

          float grid = max(step(0.97, gridX), step(0.97, gridY));

          float gradient = 0.2 + 0.6 * (vPosition.y / 180.0 + 0.5);
          float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);

          vec3 finalColor = color * gradient;
          float alpha = 0.08 + grid * 0.25 + fresnel * 0.1;

          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    scene.add(globe);
    globeRef.current = globe;

    const createRing = (radius: number, thickness: number, opacity: number) => {
      const geometry = new THREE.TorusGeometry(radius, thickness, 8, 100);
      const material = new THREE.MeshBasicMaterial({
        color: "#D97757",
        transparent: true,
        opacity: opacity,
      });
      return new THREE.Mesh(geometry, material);
    };

    const ring1 = createRing(210, 1, 0.2);
    ring1.rotation.x = Math.PI / 2;
    ring1.scale.set(1, 0.25, 1);
    scene.add(ring1);

    const ring2 = createRing(240, 0.8, 0.15);
    ring2.rotation.x = Math.PI / 2;
    ring2.rotation.z = Math.PI / 4;
    ring2.scale.set(1.1, 0.2, 1);
    scene.add(ring2);

    const ring3 = createRing(270, 0.6, 0.1);
    ring3.rotation.x = Math.PI / 2;
    ring3.rotation.z = -Math.PI / 4;
    ring3.scale.set(1.2, 0.15, 1);
    scene.add(ring3);

    const onMouseDown = (e: MouseEvent) => {
      isDragging.current = true;
      previousMousePosition.current = { x: e.clientX, y: e.clientY };
      containerRef.current!.style.cursor = "grabbing";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const deltaX = e.clientX - previousMousePosition.current.x;
      const deltaY = e.clientY - previousMousePosition.current.y;

      targetRotation.current.y += deltaX * 0.005;
      targetRotation.current.x += deltaY * 0.005;
      targetRotation.current.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetRotation.current.x));

      previousMousePosition.current = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging.current = false;
      containerRef.current!.style.cursor = "grab";
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetZoom.current += e.deltaY * 0.001;
      targetZoom.current = Math.max(0.5, Math.min(2, targetZoom.current));
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
      targetRotation.current.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetRotation.current.x));

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
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    let animationId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();

      if (globe) {
        globe.rotation.y += (targetRotation.current.y - globe.rotation.y) * 0.08;
        globe.rotation.x += (targetRotation.current.x - globe.rotation.x) * 0.08;
      }

      if (camera) {
        camera.position.z += (500 / targetZoom.current - camera.position.z) * 0.1;
      }

      if (ring1) ring1.rotation.z = elapsed * 0.08;
      if (ring2) ring2.rotation.z = elapsed * 0.06 + Math.PI / 4;
      if (ring3) ring3.rotation.z = elapsed * 0.04 - Math.PI / 4;

      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
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

// 世界地图背景
export function WorldMapBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* 简化世界地图轮廓 */}
        <defs>
          <pattern id="worldMap" x="0" y="0" width="1000" height="500" patternUnits="userSpaceOnUse">
            <path
              fill="none"
              stroke="#D97757"
              strokeWidth="0.5"
              d="M150,120 Q100,150 80,200 Q70,250 90,300 Q120,350 180,380 Q220,400 280,390 Q340,370 380,340 Q420,300 450,250 Q480,200 520,180 Q560,160 600,170 Q650,190 700,230 Q750,280 780,340 Q800,380 820,400 Q850,410 900,400 Q950,380 970,340 Q980,300 960,260 Q930,200 880,160 Q820,120 750,100 Q680,80 600,90 Q520,110 450,140 Q380,180 320,200 Q260,220 200,200 Q160,180 150,120"
            />
            {/* 各大洲轮廓 */}
            {/* 北美 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M50,80 Q80,60 120,70 Q180,90 200,120 Q210,150 190,180 Q160,200 120,190 Q80,170 50,140 Q30,110 50,80"/>
            {/* 南美 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M180,280 Q200,260 220,280 Q250,320 260,380 Q250,440 220,460 Q180,470 160,440 Q140,400 150,350 Q160,300 180,280"/>
            {/* 欧洲 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M420,60 Q480,50 520,70 Q560,90 550,130 Q530,160 490,150 Q450,130 420,100 Q400,80 420,60"/>
            {/* 非洲 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M450,180 Q500,170 530,200 Q560,240 560,300 Q540,360 500,380 Q450,390 420,360 Q390,320 400,270 Q410,220 450,180"/>
            {/* 亚洲 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M550,60 Q650,50 750,80 Q850,120 880,180 Q900,240 860,280 Q800,300 720,280 Q640,250 580,200 Q520,150 550,100 Q570,70 550,60"/>
            {/* 澳洲 */}
            <path fill="none" stroke="#D97757" strokeWidth="0.5" d="M780,350 Q850,330 890,360 Q920,400 900,440 Q860,470 810,460 Q760,440 750,400 Q740,360 780,350"/>
          </pattern>
        </defs>
        <rect width="1000" height="500" fill="url(#worldMap)" />
      </svg>
    </div>
  );
}