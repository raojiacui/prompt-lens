"use client";

import { useEffect, useRef, useState } from "react";
import * as am5 from "@amcharts/amcharts5";
import * as am5map from "@amcharts/amcharts5/map";
import am5geodata_worldLow from "@amcharts/amcharts5-geodata/worldLow";
import am5themes_Animated from "@amcharts/amcharts5/themes/Animated";

export function LoginGlobeBackground() {
  const flatMapRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    let disposed = false;
    let flatRoot: am5.Root | undefined;
    let globeRoot: am5.Root | undefined;
    let autoRotate = true;
    let lastFrameTime = 0;

    try {
      if (!flatMapRef.current || !globeRef.current) {
        return;
      }

      flatRoot = am5.Root.new(flatMapRef.current);
      flatRoot.setThemes([am5themes_Animated.new(flatRoot)]);
      flatRoot._logo?.dispose();

      const flatChart = flatRoot.container.children.push(
        am5map.MapChart.new(flatRoot, {
          projection: am5map.geoEquirectangular(),
          rotationX: 180,
          panX: "none",
          panY: "none",
          wheelY: "none",
          pinchZoom: false,
          zoomLevel: 0.96,
        })
      );

      const flatBackground = flatChart.series.push(am5map.GraticuleSeries.new(flatRoot, {}));
      flatBackground.mapLines.template.setAll({
        stroke: am5.color(0xd97757),
        strokeOpacity: 0.12,
        strokeWidth: 0.65,
      });

      const flatCountries = flatChart.series.push(
        am5map.MapPolygonSeries.new(flatRoot, {
          geoJSON: am5geodata_worldLow,
          exclude: ["AQ"],
        })
      );
      flatCountries.mapPolygons.template.setAll({
        fill: am5.color(0xd8b58d),
        fillOpacity: 0.2,
        stroke: am5.color(0xb87954),
        strokeOpacity: 0.26,
        strokeWidth: 0.55,
        interactive: false,
      });

      flatChart.appear(900, 100);

      globeRoot = am5.Root.new(globeRef.current);
      globeRoot.setThemes([am5themes_Animated.new(globeRoot)]);
      globeRoot._logo?.dispose();

      globeRoot.container.set(
        "background",
        am5.Rectangle.new(globeRoot, {
          fill: am5.color(0xf5f3ec),
          fillOpacity: 0,
        })
      );

      const globeChart = globeRoot.container.children.push(
        am5map.MapChart.new(globeRoot, {
          panX: "rotateX",
          panY: "rotateY",
          projection: am5map.geoOrthographic(),
          rotationX: -24,
          rotationY: -18,
          minZoomLevel: 0.65,
          maxZoomLevel: 4,
          zoomLevel: 0.98,
          wheelY: "zoom",
          pinchZoom: true,
        })
      );

      const globeBackground = globeChart.series.push(am5map.MapPolygonSeries.new(globeRoot, {}));
      globeBackground.mapPolygons.template.setAll({
        fill: am5.color(0xeadbc3),
        fillOpacity: 0.96,
        strokeOpacity: 0,
      });
      globeBackground.data.push({
        geometry: am5map.getGeoRectangle(90, 180, -90, -180),
      });

      const globeGraticule = globeChart.series.push(am5map.GraticuleSeries.new(globeRoot, {}));
      globeGraticule.mapLines.template.setAll({
        stroke: am5.color(0xd97757),
        strokeOpacity: 0.28,
        strokeWidth: 0.8,
      });

      const globeCountries = globeChart.series.push(
        am5map.MapPolygonSeries.new(globeRoot, {
          geoJSON: am5geodata_worldLow,
          exclude: ["AQ"],
        })
      );

      globeCountries.mapPolygons.template.setAll({
        fill: am5.color(0xf7ead8),
        fillOpacity: 0.98,
        stroke: am5.color(0xb87954),
        strokeOpacity: 0.72,
        strokeWidth: 0.7,
        tooltipText: "",
      });

      const highlightedCountries = new Set([
        "CN",
        "US",
        "GB",
        "DE",
        "FR",
        "JP",
        "SG",
        "BR",
        "AU",
        "IN",
      ]);

      globeCountries.events.on("datavalidated", () => {
        am5.array.each(globeCountries.dataItems, (dataItem) => {
          const id = dataItem.get("id");
          if (id && highlightedCountries.has(id)) {
            dataItem.get("mapPolygon")?.setAll({
              fill: am5.color(0xe5c29d),
              fillOpacity: 1,
            });
          }
        });
      });

      globeRoot.events.on("frameended", () => {
        if (!autoRotate) {
          lastFrameTime = Date.now();
          return;
        }

        const now = Date.now();
        if (!lastFrameTime) {
          lastFrameTime = now;
          return;
        }

        const elapsedSeconds = (now - lastFrameTime) / 1000;
        lastFrameTime = now;
        globeChart.set("rotationX", (globeChart.get("rotationX") ?? 0) + elapsedSeconds * 2.4);
      });

      const pauseAutoRotation = () => {
        autoRotate = false;
      };

      const resumeAutoRotation = () => {
        autoRotate = true;
        lastFrameTime = Date.now();
      };

      globeChart.chartContainer.events.on("pointerdown", pauseAutoRotation);
      globeChart.chartContainer.events.on("pointerup", resumeAutoRotation);
      globeChart.chartContainer.events.on("globalpointerup", resumeAutoRotation);
      globeChart.chartContainer.events.on("wheel", resumeAutoRotation);

      globeChart.appear(900, 100);
    } catch (error) {
      console.error("Login globe background failed to initialize:", error);
      setFailed(true);
    }

    return () => {
      disposed = true;
      flatRoot?.dispose();
      globeRoot?.dispose();
    };
  }, [mounted]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-[#ECE9E0]">
      <div
        ref={flatMapRef}
        className="pointer-events-none absolute left-1/2 top-1/2 h-[104vh] w-[132vw] -translate-x-1/2 -translate-y-1/2 opacity-100"
      />
      <div
        ref={globeRef}
        className="absolute inset-x-0 inset-y-[-8%] cursor-grab opacity-100 active:cursor-grabbing"
        style={{ touchAction: "none" }}
      />
      {failed ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_55%_at_25%_35%,rgba(217,119,87,0.16),transparent_62%),linear-gradient(120deg,#ECE9E0,#F5F3EC)]" />
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(245,243,236,0.04),rgba(245,243,236,0.10)_58%,rgba(245,243,236,0.18))]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_50%,transparent_0%,rgba(236,233,224,0.05)_68%,rgba(236,233,224,0.16)_100%)]" />
    </div>
  );
}