'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

interface VantaBackgroundProps {
  className?: string;
  mouseControls?: boolean;
  touchControls?: boolean;
  gyroControls?: boolean;
  minHeight?: number;
  minWidth?: number;
  blurFactor?: number;
  scale?: number;
  color?: number;
  backgroundColor?: number;
  fogTime?: number;
  highlightColor?: number;
  midtoneColor?: number;
  lowlightColor?: number;
  baseColor?: number;
}

export function VantaBackground({
  className = '',
  mouseControls = true,
  touchControls = true,
  gyroControls = false,
  minHeight = 200.00,
  minWidth = 200.00,
  blurFactor = 0.52,
  scale = 1.0,
  color = 0x5,
  backgroundColor = 0x0,
  fogTime = 0.3,
  highlightColor = 0x80ff,
  midtoneColor = 0x3677e,
  lowlightColor = 0x0,
  baseColor = 0x0
}: VantaBackgroundProps) {
  const vantaRef = useRef<HTMLDivElement>(null);
  const [vantaEffect, setVantaEffect] = useState<any>(null);
  const [threeLoaded, setThreeLoaded] = useState(false);
  const [vantaLoaded, setVantaLoaded] = useState(false);

  // Initialize Vanta effect after both scripts are loaded
  useEffect(() => {
    if (!threeLoaded || !vantaLoaded || !vantaRef.current) {
      console.log("Scripts not loaded yet or ref not available", { threeLoaded, vantaLoaded });
      return;
    }

    console.log("Attempting to initialize VANTA effect");
    
    if (!vantaEffect && window.VANTA) {
      try {
        console.log("Creating VANTA.FOG effect");
        const effect = window.VANTA.FOG({
          el: vantaRef.current,
          mouseControls,
          touchControls,
          gyroControls,
          minHeight,
          minWidth,
          blurFactor,
          scale,
          color,
          backgroundColor,
          highlightColor,
          midtoneColor,
          lowlightColor,
          baseColor,
          fogTime
        });
        
        console.log("VANTA effect created successfully");
        setVantaEffect(effect);
      } catch (error) {
        console.error("Error initializing VANTA effect:", error);
      }
    }

    return () => {
      if (vantaEffect) {
        console.log("Destroying VANTA effect");
        vantaEffect.destroy();
      }
    };
  }, [threeLoaded, vantaLoaded, vantaEffect, mouseControls, touchControls, gyroControls, minHeight, minWidth, blurFactor, scale, color, backgroundColor, highlightColor, midtoneColor, lowlightColor, baseColor, fogTime]);

  const handleThreeLoaded = () => {
    console.log('Three.js loaded');
    setThreeLoaded(true);
  };

  const handleVantaLoaded = () => {
    console.log('Vanta.js loaded');
    setVantaLoaded(true);
  };

  return (
    <>
      <Script 
        src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js" 
        strategy="afterInteractive"
        onLoad={handleThreeLoaded}
      />
      <Script 
        src="https://cdn.jsdelivr.net/npm/vanta@latest/dist/vanta.fog.min.js" 
        strategy="afterInteractive" 
        onLoad={handleVantaLoaded}
      />
      <div 
        ref={vantaRef} 
        className={`absolute inset-0 -z-10 ${className}`}
        style={{ height: '100%', width: '100%' }}
        aria-hidden="true"
      />
    </>
  );
}

// Add TypeScript declaration for VANTA
declare global {
  interface Window {
    VANTA: {
      FOG: (config: any) => any;
    };
  }
}
