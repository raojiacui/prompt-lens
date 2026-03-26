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

// 世界地图背景 - 精确的大陆和大洋轮廓
export function WorldMapBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      <svg
        className="absolute inset-0 w-full h-full opacity-15"
        viewBox="0 0 1000 500"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="oceanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#D97757" stopOpacity="0.5"/>
            <stop offset="100%" stopColor="#D97757" stopOpacity="0.2"/>
          </linearGradient>
        </defs>

        {/* 海洋背景 */}
        <rect width="1000" height="500" fill="url(#oceanGrad)"/>

        {/* 北美洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M20,30 Q50,15 90,25 Q130,35 160,55 Q200,85 220,130 Q235,170 220,210 Q200,250 160,275 Q110,290 70,275 Q30,250 25,200 Q20,150 30,100 Q25,60 20,30
             M130,45 Q170,35 190,55 Q205,80 190,105 Q165,125 130,115 Q95,95 130,45
             M55,165 Q85,155 105,175 Q115,205 95,235 Q60,255 35,230 Q15,195 55,165
             M85,200 Q115,190 130,210 Q135,235 115,255 Q80,270 55,250 Q35,220 85,200
             M160,145 Q190,135 210,155 Q220,180 200,210 Q170,235 140,220 Q115,195 160,145
             M50,280 Q80,270 100,295 Q110,330 85,365 Q50,390 25,360 Q5,320 50,280"/>

        {/* 南美洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M180,295 Q210,280 235,305 Q260,340 275,390 Q280,450 255,495 Q210,530 165,520 Q120,495 115,435 Q110,375 130,320 Q150,280 180,295
             M145,340 Q175,325 195,355 Q205,395 185,435 Q150,465 115,445 Q85,405 100,355 Q115,320 145,340
             M170,380 Q195,365 210,395 Q215,435 195,475 Q160,505 130,485 Q105,450 120,400 Q140,360 170,380"/>

        {/* 欧洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M420,45 Q480,25 540,45 Q590,75 600,125 Q595,175 545,205 Q480,225 425,195 Q375,155 380,100 Q390,55 420,45
             M445,85 Q490,65 530,90 Q555,125 530,165 Q485,195 440,170 Q400,135 445,85
             M550,95 Q600,75 640,105 Q665,145 640,195 Q600,235 555,220 Q510,190 515,135 Q530,85 550,95
             M440,145 Q485,125 520,155 Q540,195 515,240 Q470,275 425,255 Q385,220 405,165 Q420,135 440,145"/>

        {/* 非洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M450,195 Q530,165 590,210 Q655,265 680,340 Q690,430 625,485 Q545,525 465,495 Q385,455 380,370 Q375,290 420,230 Q450,200 450,195
             M460,260 Q530,235 575,280 Q600,340 575,405 Q520,460 455,440 Q395,405 410,330 Q430,270 460,260
             M520,310 Q580,285 620,340 Q640,405 600,470 Q530,515 465,490 Q405,450 425,375 Q460,315 520,310
             M565,365 Q625,340 660,400 Q680,470 630,535 Q555,570 485,540 Q420,495 455,410 Q500,365 565,365
             M490,420 Q550,395 585,455 Q600,520 545,580 Q470,615 400,580 Q350,530 385,450 Q430,400 490,420"/>

        {/* 亚洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M560,35 Q680,15 810,45 Q950,95 985,185 Q1000,295 955,380 Q880,445 770,435 Q660,415 580,350 Q510,275 530,175 Q560,85 560,35
             M590,75 Q720,45 850,85 Q960,155 970,270 Q960,380 880,450 Q770,500 660,475 Q550,430 540,325 Q535,215 590,75
             M800,95 Q910,65 970,135 Q1000,225 970,325 Q910,405 810,435 Q700,450 640,390 Q580,310 660,200 Q740,110 800,95
             M880,145 Q960,115 1000,195 Q1010,295 960,385 Q880,455 790,465 Q690,460 690,355 Q695,245 780,155 Q850,130 880,145
             M920,215 Q980,185 1000,255 Q1000,335 950,415 Q870,475 780,470 Q690,450 730,340 Q765,255 860,205 Q910,195 920,215
             M650,295 Q760,260 850,335 Q905,420 850,515 Q755,580 650,560 Q545,520 580,400 Q620,305 650,295
             M720,365 Q820,330 890,415 Q920,505 850,590 Q745,645 640,610 Q540,555 595,430 Q665,365 720,365"/>

        {/* 澳洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="1.2" d="M780,365 Q880,325 945,395 Q990,480 965,560 Q890,610 795,585 Q700,545 725,455 Q770,380 780,365
             M810,415 Q890,380 935,450 Q955,530 905,600 Q820,640 745,605 Q680,550 735,450 Q790,385 810,415
             M780,470 Q840,440 875,495 Q885,545 835,590 Q760,615 710,570 Q670,510 730,465 Q770,445 780,470"/>

        {/* 南极洲 */}
        <path fill="none" stroke="#D97757" strokeWidth="2" d="M50,485 Q200,475 400,478 Q600,481 800,485 Q950,490 980,495"/>

        {/* 格陵兰岛 */}
        <path fill="none" stroke="#D97757" strokeWidth="1" d="M250,15 Q340,5 390,45 Q420,100 390,165 Q330,210 260,195 Q200,160 220,95 Q240,35 250,15"/>

        {/* 冰岛 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M365,75 Q390,65 405,85 Q415,115 395,145 Q365,165 340,135 Q320,105 365,75"/>

        {/* 日本 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M855,145 Q870,135 885,155 Q895,185 880,220 Q855,255 835,215 Q820,175 855,145"/>

        {/* 英国 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.8" d="M365,95 Q400,80 420,105 Q430,140 410,175 Q380,205 355,170 Q330,135 365,95"/>

        {/* 大西洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.6" strokeDasharray="10,5" d="M300,100 Q350,180 320,280 Q290,380 380,480"/>
        {/* 太平洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.6" strokeDasharray="10,5" d="M650,50 Q780,150 700,320 Q620,460 780,490"/>
        {/* 印度洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.6" strokeDasharray="10,5" d="M600,320 Q700,400 850,460"/>
        {/* 北冰洋 */}
        <path fill="none" stroke="#D97757" strokeWidth="0.6" strokeDasharray="10,5" d="M150,30 Q400,15 650,25"/>
      </svg>
    </div>
  );
}