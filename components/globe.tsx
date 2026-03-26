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

// 简洁世界地图背景
export function WorldMapBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute inset-0 w-full h-full opacity-20"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid slice"
      >
        {/* 北美洲 - 左边大块，下面有加州半岛和佛罗里达 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M30,20 L100,15 L170,30 L220,60 L250,110 L260,170 L240,230 L200,280 L150,300 L100,290 L60,250 L40,190 L30,120 L20,60 Z
               M170,250 L200,255 L210,280 L190,310 L160,305 L155,275 Z
               M120,120 L150,115 L165,140 L150,170 L120,175 L110,145 Z"

          strokeLinejoin="round"
        />

        {/* 南美洲 - 中间偏左，长的三角形 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M180,310 L220,290 L260,320 L290,380 L300,450 L270,510 L210,530 L160,510 L140,450 L150,380 L160,340 Z"
          strokeLinejoin="round"
        />

        {/* 欧洲 - 中间偏上，比较小 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M400,40 L470,30 L530,50 L570,90 L580,150 L560,200 L510,220 L450,210 L400,180 L380,130 L390,80 Z
               M430,80 L470,70 L500,95 L490,130 L450,145 L420,120 Z
               M530,100 L570,90 L600,120 L590,160 L550,180 L520,150 Z"
          strokeLinejoin="round"
        />

        {/* 非洲 - 中间，很大一块 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M440,200 L520,180 L600,220 L670,280 L700,360 L690,460 L620,520 L530,540 L440,510 L370,460 L360,380 L370,300 L400,250 Z
               M480,300 L540,280 L580,330 L570,400 L520,440 L470,410 L450,350 Z
               M560,350 L620,330 L660,400 L640,470 L580,500 L530,470 L540,400 Z"
          strokeLinejoin="round"
        />

        {/* 亚洲 - 右边，最大的洲 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M560,30 L700,20 L850,50 L970,120 L1000,220 L990,340 L930,420 L820,450 L700,440 L600,380 L530,300 L540,200 L560,100 Z
               M620,80 L750,50 L870,90 L940,170 L930,280 L870,350 L770,380 L680,350 L640,270 L650,170 L680,100 Z
               M800,100 L900,70 L970,150 L980,270 L930,350 L840,390 L750,380 L770,270 L810,180 L850,130 Z
               M880,180 L960,150 L1000,250 L970,350 L900,410 L810,430 L820,320 L870,230 L920,190 Z"
          strokeLinejoin="round"
        />

        {/* 澳洲 - 右下角 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.5"
          d="M780,380 L880,350 L950,420 L970,510 L910,570 L820,580 L750,540 L760,460 L780,380 Z
               M830,420 L900,400 L940,470 L920,550 L850,570 L800,530 L820,460 Z"
          strokeLinejoin="round"
        />

        {/* 格陵兰岛 - 北边 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="1.2"
          d="M280,25 L360,15 L410,55 L400,130 L340,180 L270,170 L240,100 L260,45 Z"
          strokeLinejoin="round"
        />

        {/* 冰岛 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.8"
          d="M370,75 L405,65 L425,95 L415,140 L380,160 L350,130 L365,90 Z"
          strokeLinejoin="round"
        />

        {/* 英国 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.8"
          d="M365,95 L410,80 L435,115 L425,160 L390,185 L355,155 L360,110 Z"
          strokeLinejoin="round"
        />

        {/* 日本 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.8"
          d="M860,150 L890,135 L910,170 L905,220 L875,265 L850,230 L845,180 Z"
          strokeLinejoin="round"
        />

        {/* 各大洋 - 虚线 */}
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.5"
          strokeDasharray="15,8"
          d="M250,100 Q320,180 280,300 Q240,420 350,490"
        />
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.5"
          strokeDasharray="15,8"
          d="M650,60 Q780,180 700,350 Q620,500 780,490"
        />
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.5"
          strokeDasharray="15,8"
          d="M600,330 Q700,420 850,470"
        />
        <path
          fill="none"
          stroke="#D97757"
          strokeWidth="0.5"
          strokeDasharray="15,8"
          d="M150,35 Q400,15 650,25"
        />
      </svg>
    </div>
  );
}