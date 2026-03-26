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

// 世界地图背景 - 含各大洲和各大洋轮廓
export function WorldMapBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute inset-0 w-full h-full opacity-12"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="oceanGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D97757" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="#D97757" stopOpacity="0.2"/>
          </linearGradient>
        </defs>

        {/* 海洋背景 */}
        <rect width="1000" height="500" fill="url(#oceanGradient)"/>

        {/* 北美洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M30,30 Q100,10 180,30 Q250,60 280,120 Q300,180 270,230 Q220,270 150,280 Q80,280 40,240 Q10,190 30,130 Q20,70 30,30
             M150,60 Q180,50 200,70 Q210,100 190,130 Q160,150 130,130 Q100,100 150,60
             M50,160 Q90,150 120,180 Q130,220 100,250 Q60,270 30,240 Q10,200 50,160"/>

        {/* 南美洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M180,290 Q230,260 280,300 Q320,360 330,430 Q320,490 260,510 Q190,520 150,480 Q110,430 120,360 Q130,310 180,290"/>

        {/* 欧洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M400,40 Q480,20 560,50 Q620,90 630,150 Q620,210 560,230 Q480,240 420,200 Q360,150 380,90 Q390,50 400,40
             M450,90 Q500,70 540,100 Q560,140 530,180 Q480,210 440,180 Q400,140 450,90
             M560,120 Q600,100 630,140 Q640,190 600,230 Q550,260 510,220 Q470,170 560,120"/>

        {/* 非洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M440,200 Q520,170 590,220 Q660,280 680,360 Q680,450 600,500 Q500,530 420,490 Q340,440 350,350 Q360,270 440,200
             M470,270 Q530,250 570,290 Q590,350 550,400 Q480,440 430,390 Q380,330 470,270
             M550,320 Q610,300 650,350 Q660,410 620,450 Q560,480 510,430 Q460,370 550,320"/>

        {/* 亚洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M560,30 Q700,10 850,50 Q980,110 1000,200 Q1010,300 950,370 Q850,420 720,400 Q590,370 520,300 Q450,220 500,130 Q540,60 560,30
             M620,70 Q720,40 820,80 Q890,140 860,220 Q800,280 700,290 Q600,280 620,200 Q620,120 620,70
             M850,120 Q920,90 970,150 Q990,220 950,290 Q880,340 800,320 Q720,280 780,200 Q820,140 850,120
             M920,220 Q970,190 1000,250 Q1010,320 960,380 Q890,420 820,380 Q760,320 830,250 Q880,210 920,220
             M700,290 Q800,260 870,320 Q900,400 840,470 Q750,510 670,460 Q600,390 670,310 Q720,270 700,290"/>

        {/* 澳洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M780,360 Q880,320 950,380 Q990,450 960,520 Q870,560 790,530 Q710,490 730,410 Q770,350 780,360
             M830,400 Q900,370 940,420 Q950,480 900,530 Q830,560 780,510 Q730,450 830,400"/>

        {/* 南极洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.5" d="M100,490 Q300,475 500,480 Q700,485 900,490"/>

        {/* 格陵兰岛 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M280,20 Q350,10 390,50 Q410,100 380,150 Q320,180 270,160 Q220,120 250,70 Q270,40 280,20"/>

        {/* 冰岛 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M380,80 Q400,70 410,90 Q415,110 400,125 Q380,135 365,115 Q355,95 380,80"/>

        {/* 日本 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M870,150 Q880,140 890,160 Q895,190 880,220 Q860,240 845,210 Q835,180 860,160 Q865,150 870,150"/>

        {/* 英国 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M380,100 Q400,90 415,110 Q420,140 400,160 Q380,170 365,145 Q355,120 380,100"/>

        {/* 大西洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.5" strokeDasharray="8,8" d="M320,140 Q380,200 350,300 Q320,400 400,480"/>

        {/* 太平洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.5" strokeDasharray="8,8" d="M680,80 Q780,200 720,380 Q660,480 780,500"/>

        {/* 印度洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.5" strokeDasharray="8,8" d="M600,320 Q680,400 780,450"/>

        {/* 北冰洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.5" strokeDasharray="8,8" d="M200,50 Q400,30 600,40"/>
      </svg>
    </div>
  );
}