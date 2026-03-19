"use client";

import { useRef, useEffect, useState } from "react";

type AnnotationData = {
  screenshot: string;
  cx: number;
  cy: number;
  label: string;
  isCamera?: boolean;
};

export default function Overlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasAnnotation, setHasAnnotation] = useState(false);
  const [label, setLabel] = useState("");

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "n22-annotation") {
        const { screenshot, cx, cy, label: lbl, isCamera } = e.data as AnnotationData & { type: string };
        renderAnnotation(screenshot, cx, cy, lbl, isCamera);
      } else if (e.data?.type === "n22-clear") {
        clearCanvas();
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasAnnotation(false);
    setLabel("");
  };

  const renderAnnotation = (screenshot: string, cx: number, cy: number, lbl: string, isCamera?: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const img = new Image();
    img.src = `data:image/jpeg;base64,${screenshot}`;
    img.onload = () => {
      const W = canvas.clientWidth * (window.devicePixelRatio || 1);
      const H = Math.round((img.height / img.width) * W);
      canvas.width = W;
      canvas.height = H;
      canvas.style.height = `${H / (window.devicePixelRatio || 1)}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw screenshot
      ctx.filter = "brightness(0.88)";
      ctx.drawImage(img, 0, 0, W, H);
      ctx.filter = "none";

      const px = cx * W;
      const py = cy * H;

      if (isCamera) {
        // Crosshair
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(px, py, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Ripple rings
        for (let r = 0; r < 3; r++) {
          const radius = 18 + r * 14;
          ctx.strokeStyle = `rgba(255,255,255,${0.35 - r * 0.09})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Filled dot at center
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        // Cursor arrow
        ctx.fillStyle = "white";
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + 16, py + 10);
        ctx.lineTo(px + 8, py + 12);
        ctx.lineTo(px + 4, py + 20);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      setLabel(lbl);
      setHasAnnotation(true);
    };
  };

  return (
    <div style={{
      background: "#0A0A0A",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.06em",
        }}>
          N22
        </span>
        {hasAnnotation && (
          <span style={{
            fontSize: 9,
            fontWeight: 600,
            color: "#4ADE80",
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(74,222,128,0.1)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}>
            Live
          </span>
        )}
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!hasAnnotation ? (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 20,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", fontWeight: 400 }}>
              Annotations will appear here
            </span>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <canvas
              ref={canvasRef}
              style={{
                width: "100%",
                display: "block",
                borderRadius: 0,
              }}
            />
          </div>
        )}
      </div>

      {/* Label bar */}
      {hasAnnotation && label && (
        <div style={{
          padding: "8px 14px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}>
          <p style={{
            fontSize: 12,
            fontWeight: 500,
            color: "rgba(255,255,255,0.55)",
            margin: 0,
            lineHeight: 1.4,
          }}>
            {label}
          </p>
        </div>
      )}
    </div>
  );
}
