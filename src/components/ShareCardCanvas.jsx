import React, { useRef } from "react";
import { Download } from "lucide-react";
import { ATTRS } from "../data/attrs.js";
import { sfx } from "../lib/audio.js";

function ShareCardCanvas({ name, goatScore, tierLabel, picks }) {
  const canvasRef = useRef(null);
  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = 1000, H = 600;
    canvas.width = W;
    canvas.height = H;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#16130F");
    bg.addColorStop(1, "#2A1210");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#B08D3F";
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, W - 32, H - 32);

    ctx.fillStyle = "#B08D3F";
    ctx.font = "600 22px monospace";
    ctx.fillText("CAGELAB", 48, 70);

    ctx.fillStyle = "#F7F3E9";
    ctx.font = "700 44px sans-serif";
    ctx.fillText(name.toUpperCase(), 48, 140);

    ctx.fillStyle = "#8C1D18";
    ctx.font = "900 140px sans-serif";
    ctx.fillText(String(goatScore), 48, 300);
    ctx.fillStyle = "#B08D3F";
    ctx.font = "600 22px monospace";
    ctx.fillText("GOAT SCORE · " + tierLabel, 48, 335);

    let y = 400;
    ATTRS.slice(0, 6).forEach((a) => {
      const p = picks[a.key];
      ctx.fillStyle = "#A79A87";
      ctx.font = "600 16px monospace";
      ctx.fillText(a.label.toUpperCase(), 48, y);
      ctx.fillStyle = "#F7F3E9";
      ctx.font = "600 16px monospace";
      ctx.fillText(`${p.fighter} (${p.display})`, 240, y);
      y += 30;
    });

    ctx.fillStyle = "#4A4640";
    ctx.font = "500 14px monospace";
    ctx.fillText("Build the GOAT · cagelab", 48, H - 40);
  }
  function downloadImage() {
    draw();
    sfx("select");
    const canvas = canvasRef.current;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = "cagelab-build.png";
    a.click();
  }
  return (
    <div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <button className="btn btn-ghost" onClick={downloadImage}><Download size={16} /> Download Image</button>
    </div>
  );
}

export default ShareCardCanvas;
