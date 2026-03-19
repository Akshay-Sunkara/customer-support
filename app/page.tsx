"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type Annotation = { id: number; screenshot: string; cx: number; cy: number; label: string; isCamera?: boolean };
type Msg = { role: "user" | "ceres"; text: string; annotation?: { screenshot: string; cx: number; cy: number; label: string; isCamera?: boolean } };

const BAR_COUNT = 40;
const BAR_W = 4;
const BAR_GAP = 4;
const MAX_BAR_H = 120;

export default function Home() {
  const [phase, setPhase] = useState<"active" | "ending" | "ended">("active");
  const [isMuted, setIsMuted] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [showWait, setShowWait] = useState(false);
  const [isEmbed, setIsEmbed] = useState(false);

  useEffect(() => { try { setIsEmbed(window.self !== window.top); } catch { setIsEmbed(true); } }, []);

  const chatWidth = isEmbed ? 260 : 380;

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const animFrameRef = useRef<number>(0);
  const dialogueRef = useRef<{ role: string; text: string }[]>([]);
  const stepHistoryRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const isMutedRef = useRef(false);
  const sharingRef = useRef(false);
  const cameraOnRef = useRef(false);
  const annotationIdRef = useRef(0);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatOpenRef = useRef(false);
  const handleUserMessageRef = useRef<(t: string, s?: "voice" | "chat") => void>(() => {});
  const customPromptRef = useRef<string | null>(null);

  // Load custom prompt from ?room= param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get("room");
    if (roomId) {
      const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || "http://localhost:3000";
      fetch(`${dashboardUrl}/api/avatar/room?id=${encodeURIComponent(roomId)}`)
        .then(r => r.json())
        .then(data => {
          if (data.prompt) customPromptRef.current = data.prompt;
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => { sharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { cameraOnRef.current = isCameraOn; }, [isCameraOn]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // Auto-hide controls
  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => { if (!chatOpen) setShowControls(false); }, 4000);
  }, [chatOpen]);

  useEffect(() => {
    if (phase !== "active") return;
    const h = () => resetControlsTimer();
    window.addEventListener("mousemove", h);
    window.addEventListener("touchstart", h);
    resetControlsTimer();
    return () => { window.removeEventListener("mousemove", h); window.removeEventListener("touchstart", h); if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current); };
  }, [phase, resetControlsTimer]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, chatOpen]);

  // ── Waveform animation loop ──
  useEffect(() => {
    if (phase !== "active") return;
    const canvas = waveCanvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const ctx = canvas.getContext("2d")!;
    const freqData = new Uint8Array(BAR_COUNT);
    const smoothed = smoothedRef.current;

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const isSpeaking = speakingRef.current;
      const analyser = analyserRef.current;

      // Get frequency data or generate ambient
      if (isSpeaking && analyser) {
        analyser.getByteFrequencyData(freqData);
      }

      const totalW = BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP;
      const startX = (w - totalW) / 2;
      const centerY = h / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        let target: number;
        if (isSpeaking && analyser) {
          target = (freqData[i] / 255) * MAX_BAR_H;
        } else {
          const t = Date.now() / 1400;
          target = (Math.sin(t + i * 0.3) * 0.5 + 0.5) * 18 + 6;
        }

        smoothed[i] += (target - smoothed[i]) * (isSpeaking ? 0.4 : 0.12);
        const barH = Math.max(1, smoothed[i]);
        const x = startX + i * (BAR_W + BAR_GAP);

        // Pure white, high contrast against black
        const alpha = isSpeaking
          ? Math.min(1, barH / MAX_BAR_H * 1.2 + 0.15)
          : Math.min(0.5, barH / MAX_BAR_H * 1.5 + 0.25);

        ctx.fillStyle = `rgba(255,255,255,${alpha})`;

        const half = barH / 2;
        ctx.beginPath();
        ctx.roundRect(x, centerY - half, BAR_W, half, [BAR_W / 2, BAR_W / 2, 0, 0]);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(x, centerY, BAR_W, half, [0, 0, BAR_W / 2, BAR_W / 2]);
        ctx.fill();

        if (isSpeaking && barH > 8) {
          ctx.fillStyle = `rgba(255,255,255,${alpha * 0.06})`;
          ctx.beginPath();
          ctx.roundRect(x, centerY + half + 10, BAR_W, half * 0.4, [0, 0, BAR_W / 2, BAR_W / 2]);
          ctx.fill();
        }
      }

      ctx.restore();
    };

    draw();
    return () => { cancelAnimationFrame(animFrameRef.current); window.removeEventListener("resize", resize); };
  }, [phase]);

  // ── Unlock AudioContext on first user gesture (Chrome autoplay policy) ──
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 128;
        analyserRef.current.smoothingTimeConstant = 0.75;
        analyserRef.current.connect(audioCtxRef.current.destination);
      }
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("touchstart", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  // ── Cartesia TTS with AudioContext ──
  const speak = useCallback(async (text: string) => {
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
    speakingRef.current = true;
    setSpeaking(true);
    dialogueRef.current.push({ role: "ceres", text });
    setMessages((prev) => [...prev, { role: "ceres", text }]);

    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!res.ok) throw new Error(`TTS ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      // Set up AudioContext + Analyser
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 128;
        analyserRef.current.smoothingTimeConstant = 0.75;
        analyserRef.current.connect(audioCtxRef.current.destination);
      }
      if (audioCtxRef.current.state === "suspended") {
        try { await audioCtxRef.current.resume(); } catch {}
      }

      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // Connect to analyser only if AudioContext is running
      if (audioCtxRef.current.state === "running") {
        const source = audioCtxRef.current.createMediaElementSource(audio);
        source.connect(analyserRef.current!);
      }

      audio.onended = () => { speakingRef.current = false; setSpeaking(false); URL.revokeObjectURL(url); currentAudioRef.current = null; };
      audio.onerror = () => { speakingRef.current = false; setSpeaking(false); URL.revokeObjectURL(url); currentAudioRef.current = null; };

      try {
        await audio.play();
      } catch {
        // Autoplay blocked — wait for user gesture then retry
        const retryPlay = async () => {
          if (audioCtxRef.current?.state === "suspended") await audioCtxRef.current.resume().catch(() => {});
          audio.play().catch(() => {});
          document.removeEventListener("click", retryPlay);
          document.removeEventListener("touchstart", retryPlay);
        };
        document.addEventListener("click", retryPlay, { once: true });
        document.addEventListener("touchstart", retryPlay, { once: true });
      }
    } catch (e) {
      console.error("[tts]", e);
      speakingRef.current = false;
      setSpeaking(false);
    }
  }, []);

  // ── Capture helpers ──
  const captureFrame = useCallback((): string | null => {
    if (!sharingRef.current) return null;
    const video = screenVideoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d"); if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.5).replace(/^data:image\/\w+;base64,/, "");
  }, []);

  const captureCameraFrame = useCallback((): string | null => {
    if (!cameraOnRef.current) return null;
    const video = cameraVideoRef.current; const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.round(video.videoWidth * scale); const h = Math.round(video.videoHeight * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d"); if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.6).replace(/^data:image\/\w+;base64,/, "");
  }, []);

  // ── PiP annotation rendering ──
  const renderAnnotationToPiP = useCallback(async (screenshot: string, cx: number, cy: number, label: string, isCamera?: boolean) => {
    const pipCanvas = pipCanvasRef.current;
    const pipVideo = pipVideoRef.current;
    if (!pipCanvas || !pipVideo) return;

    // Check if PiP is supported
    if (!document.pictureInPictureEnabled) return;

    const img = new Image();
    img.src = `data:image/jpeg;base64,${screenshot}`;
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });

    const W = 400;
    const H = Math.round((img.height / img.width) * W) + 40; // extra space for label
    pipCanvas.width = W;
    pipCanvas.height = H;

    const ctx = pipCanvas.getContext("2d");
    if (!ctx) return;

    // Draw screenshot
    const imgH = H - 40;
    ctx.fillStyle = "#0A0A0A";
    ctx.fillRect(0, 0, W, H);
    ctx.filter = "brightness(0.85)";
    ctx.drawImage(img, 0, 0, W, imgH);
    ctx.filter = "none";

    // Draw pointer/crosshair
    const px = cx * W;
    const py = cy * imgH;

    if (isCamera) {
      // Crosshair ring
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Ripple rings
      for (let r = 0; r < 3; r++) {
        const radius = 14 + r * 10;
        const alpha = 0.3 - r * 0.08;
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Cursor arrow
      ctx.fillStyle = "white";
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const s = 0.85;
      ctx.moveTo(px, py);
      ctx.lineTo(px + 14 * s, py + 9 * s);
      ctx.lineTo(px + 7 * s, py + 10.5 * s);
      ctx.lineTo(px + 3.5 * s, py + 18 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Label bar at bottom
    ctx.fillStyle = "rgba(12,12,12,0.95)";
    ctx.fillRect(0, imgH, W, 40);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "500 13px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(label.length > 50 ? label.slice(0, 47) + "..." : label, 12, imgH + 25);

    // Start PiP if not already active
    if (!pipActiveRef.current) {
      // Set up video stream from canvas
      const stream = pipCanvas.captureStream(1);
      pipVideo.srcObject = stream;
      try {
        await pipVideo.play();
        await pipVideo.requestPictureInPicture();
        pipActiveRef.current = true;

        pipVideo.addEventListener("leavepictureinpicture", () => {
          pipActiveRef.current = false;
          pipVideo.srcObject = null;
        }, { once: true });
      } catch (e) {
        console.warn("[pip] Failed to enter PiP:", e);
      }
    }
  }, []);

  const showAnnotation = useCallback((screenshot: string, cx: number, cy: number, label: string, isCamera?: boolean) => {
    const id = ++annotationIdRef.current;
    const ann = { screenshot, cx, cy, label, isCamera };
    // Only show floating toast if chat is closed
    if (!chatOpenRef.current) {
      setAnnotations((prev) => [...prev.slice(-1), { id, ...ann }]);
      setTimeout(() => setAnnotations((prev) => prev.filter((a) => a.id !== id)), 20000);
    }
    // Attach to last N22 message in chat
    setMessages((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === "ceres") {
          copy[i] = { ...copy[i], annotation: ann };
          break;
        }
      }
      return copy;
    });
    // Push to PiP if tab is not visible
    if (document.hidden) {
      renderAnnotationToPiP(screenshot, cx, cy, label, isCamera);
    }
  }, [renderAnnotationToPiP]);

  // ── Claude ──
  const processMessage = useCallback(async (userMessage: string, isFollowUp: boolean, ssOverride?: string|null, camOverride?: string|null) => {
    const screenshot = ssOverride !== undefined ? ssOverride : captureFrame();
    const cameraFrame = camOverride !== undefined ? camOverride : captureCameraFrame();
    const res = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenshot, cameraFrame, userMessage, userName: "", dialogue: dialogueRef.current.slice(-20), stepHistory: stepHistoryRef.current, isFollowUp, customPrompt: customPromptRef.current }) });
    return res.json();
  }, [captureFrame, captureCameraFrame]);

  const handleHighlight = useCallback(async (query: string, frame: string, isCamera: boolean, label?: string) => {
    try {
      const vid = isCamera ? cameraVideoRef.current : screenVideoRef.current;
      let imgW: number, imgH: number;
      if (isCamera) { const nW=vid?.videoWidth||1280; const s=Math.min(1,640/nW); imgW=Math.round(nW*s); imgH=Math.round((vid?.videoHeight||720)*s); }
      else { imgW=vid?.videoWidth||1920; imgH=vid?.videoHeight||1080; }
      const res = await fetch("/api/grounding", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshot: frame, query, imgW, imgH, isCamera }), signal: AbortSignal.timeout(14000) });
      const data = await res.json();
      console.log("[grounding] response:", JSON.stringify(data));
      if (data.cx != null) {
        const l = label || data.label || query;
        showAnnotation(frame, data.cx, data.cy, l, isCamera);
      } else {
        console.warn("[grounding] No coordinates returned — element not found");
      }
    } catch (e) { console.warn("[highlight]", e); }
  }, [showAnnotation]);

  // ── Handle user message ──
  const handleUserMessage = useCallback(async (text: string, source: "voice"|"chat" = "voice") => {
    if (processingRef.current || speakingRef.current) {
      if (speakingRef.current) {
        setShowWait(true);
        setTimeout(() => setShowWait(false), 2000);
      }
      return;
    }
    dialogueRef.current.push({ role: "user", text });
    setMessages((prev) => [...prev, { role: "user", text }]);
    processingRef.current = true; setThinking(true);
    try {
      const ss = captureFrame(); const cam = captureCameraFrame();
      const r = await processMessage(text, false, ss, cam);
      setThinking(false);
      if (!r) { processingRef.current = false; return; }
      if (r.speech) speak(r.speech);
      if (r.highlightQuery) {
        const wantsCam = r.highlightSource === "camera";
        const frame = (wantsCam && cam) ? cam : ss || cam;
        console.log("[highlight] query:", r.highlightQuery, "wantsCam:", wantsCam, "hasScreenshot:", !!ss, "hasCameraFrame:", !!cam, "frame:", !!frame);
        if (frame) {
          handleHighlight(r.highlightQuery, frame, wantsCam && !!cam, r.actionLabel);
        } else {
          console.warn("[highlight] No frame available — screen share or camera must be active");
        }
      }
      if (r.speech) stepHistoryRef.current.push(r.speech);
      if (r.done || r.action === "done") stepHistoryRef.current = [];
    } catch (e) { console.error(e); setThinking(false); }
    processingRef.current = false;
  }, [processMessage, speak, captureFrame, captureCameraFrame, handleHighlight]);

  useEffect(() => { handleUserMessageRef.current = handleUserMessage; }, [handleUserMessage]);

  // ── Toggles ──
  const toggleScreenShare = useCallback(async () => {
    if (isSharing) { screenStreamRef.current?.getTracks().forEach(t=>t.stop()); screenStreamRef.current=null; setIsSharing(false); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
        await screenVideoRef.current.play().catch((e) => console.warn("[screen] play error:", e));
      }
      stream.getVideoTracks()[0].onended = () => { screenStreamRef.current=null; setIsSharing(false); };
      setIsSharing(true);
    } catch {}
  }, [isSharing]);

  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      cameraStreamRef.current?.getTracks().forEach(t=>t.stop()); cameraStreamRef.current=null;
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject=null;
      setIsCameraOn(false); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject=stream; await cameraVideoRef.current.play().catch((e)=>console.warn("[camera] play error:", e)); }
      setIsCameraOn(true);
    } catch (e) {
      console.error("[camera] Failed to start camera:", e);
      setIsCameraOn(false);
    }
  }, [isCameraOn]);

  const micDeniedRef = useRef(false);
  const restartRecRef = useRef<(() => void) | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const pipActiveRef = useRef(false);

  const toggleMute = useCallback(async () => {
    // If mic was explicitly denied by the browser, re-request permission on unmute
    // Safari requires getUserMedia to be called directly from a user gesture (click/tap)
    if (isMuted && micDeniedRef.current) {
      try {
        // This MUST be called synchronously from the click handler for Safari
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        micDeniedRef.current = false;
        setIsMuted(false);
        // Restart speech recognition now that we have permission
        restartRecRef.current?.();
      } catch {
        // Safari: if user denied again, try opening settings hint
        // Permission is still denied — stay muted
        return;
      }
      return;
    }
    setIsMuted(p => !p);
  }, [isMuted]);

  // ── Auto-start intro on mount or restart ──
  const introRanRef = useRef(false);
  useEffect(() => {
    if (phase !== "active") return;
    if (introRanRef.current) return;
    introRanRef.current = true;
    setThinking(true);
    setTimeout(async () => {
      try {
        const res = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screenshot:null, cameraFrame:null, userMessage:"[Conversation just started. Introduce yourself based on your system prompt. Keep it to 2 sentences. Mention they can share their screen or camera for visual guidance.]", userName:"", dialogue:[], stepHistory:[], isFollowUp:false, customPrompt: customPromptRef.current }) });
        const data = await res.json(); setThinking(false);
        if (data.speech) speak(data.speech);
      } catch { setThinking(false); }
    }, 500);
  }, [speak, phase]);

  const endSession = useCallback(() => {
    if (phase === "ending" || phase === "ended") return;
    // Stop audio/streams immediately
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current=null; }
    screenStreamRef.current?.getTracks().forEach(t=>t.stop());
    cameraStreamRef.current?.getTracks().forEach(t=>t.stop());
    dialogueRef.current=[]; stepHistoryRef.current=[];
    speakingRef.current=false; processingRef.current=false;
    setChatOpen(false); setSpeaking(false); setThinking(false);
    setIsSharing(false); setIsCameraOn(false);

    // Animate out
    setPhase("ending");
    setTimeout(() => {
      smoothedRef.current.fill(0);
      setMessages([]); setAnnotations([]);
      setPhase("ended");
      // Notify parent iframe (bubble embed) to close
      try { window.parent.postMessage({ type: "n22-session-end" }, "*"); } catch {}
    }, 1200);
  }, [phase]);

  // ── Speech recognition (native browser API — works on Safari + Chrome) ──
  useEffect(() => {
    if (phase !== "active") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { console.warn("[stt] SpeechRecognition not supported"); return; }

    let stopped = false;
    let restartTimeout: ReturnType<typeof setTimeout> | null = null;

    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    // Safari doesn't handle continuous well — use short sessions and restart
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const t = e.results[i][0].transcript.trim();
        if (!t || isMutedRef.current || speakingRef.current) continue;
        handleUserMessageRef.current(t, "voice");
      }
    };

    rec.onend = () => {
      // Restart after each utterance (Safari ends after each phrase)
      if (!stopped) {
        restartTimeout = setTimeout(() => {
          if (!stopped) try { rec.start(); } catch {}
        }, 150);
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        console.warn("[stt] Mic permission denied");
        micDeniedRef.current = true;
        setIsMuted(true);
        return;
      }
      // Restart on transient errors
      if (!stopped) {
        restartTimeout = setTimeout(() => {
          if (!stopped) try { rec.start(); } catch {}
        }, 300);
      }
    };

    // Expose restart function so toggleMute can restart recognition after permission grant
    restartRecRef.current = () => {
      if (!stopped) try { rec.start(); } catch {}
    };

    // Check mic permission without triggering a prompt (Safari blocks non-gesture getUserMedia)
    const startRec = () => {
      if (!stopped) try { rec.start(); } catch {}
    };

    if (navigator.permissions?.query) {
      // Modern API: check permission state without prompting
      navigator.permissions.query({ name: "microphone" as PermissionName }).then((status) => {
        if (status.state === "denied") {
          micDeniedRef.current = true;
          setIsMuted(true);
        }
        // Start recognition regardless — Chrome handles its own prompting
        startRec();
      }).catch(() => {
        // permissions.query not supported for mic (Safari) — just try starting
        startRec();
      });
    } else {
      // Safari doesn't support permissions.query — try starting directly
      // SpeechRecognition will handle its own permission prompt on Safari
      startRec();
    }

    return () => {
      stopped = true;
      restartRecRef.current = null;
      if (restartTimeout) clearTimeout(restartTimeout);
      try { rec.stop(); } catch {}
    };
  }, [phase]);

  // ── Close PiP when user returns to tab ──
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && pipActiveRef.current && document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(() => {});
        pipActiveRef.current = false;
        if (pipVideoRef.current) pipVideoRef.current.srcObject = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  useEffect(() => () => {
    if (currentAudioRef.current) currentAudioRef.current.pause();
    screenStreamRef.current?.getTracks().forEach(t=>t.stop());
    cameraStreamRef.current?.getTracks().forEach(t=>t.stop());
    cancelAnimationFrame(animFrameRef.current);
    // Clean up PiP on unmount
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }, []);

  // ━━━━━━━━━━━━━━━━━━━━ Render ━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="h-dvh w-full relative overflow-hidden" style={{ background: "#0A0A0A", borderRadius: isEmbed ? 6 : 0 }}>

      {/* ── Ended screen ── */}
      {phase === "ended" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", gap: 0,
        }}>
          {/* Ambient glow */}
          <div style={{
            position: "absolute", width: 280, height: 280, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.03) 0%, transparent 70%)",
            animation: "ended-glow 4s ease-in-out infinite",
            pointerEvents: "none",
          }} />

          {/* Icon */}
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "ended-rise 0.6s cubic-bezier(.22,1,.36,1) both",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2z"/>
            </svg>
          </div>

          {/* Text */}
          <span style={{
            marginTop: 16, fontSize: 13, color: "rgba(255,255,255,0.25)",
            fontWeight: 400, letterSpacing: "0.04em", textTransform: "uppercase",
            animation: "ended-rise 0.6s cubic-bezier(.22,1,.36,1) 0.1s both",
          }}>
            Session ended
          </span>

          {/* Button */}
          <button
            onClick={() => { setPhase("active"); introRanRef.current = false; }}
            style={{
              marginTop: 24, padding: "10px 28px", borderRadius: 10,
              background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.5)", fontSize: 12.5, fontWeight: 500,
              cursor: "pointer", transition: "all 0.2s cubic-bezier(.22,1,.36,1)",
              fontFamily: "inherit", letterSpacing: "0.01em",
              animation: "ended-rise 0.6s cubic-bezier(.22,1,.36,1) 0.2s both",
              backdropFilter: "blur(12px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "rgba(255,255,255,0.8)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "rgba(255,255,255,0.5)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            Start new session
          </button>
        </div>
      )}

      {/* ── Active / Ending ── */}
      {(phase === "active" || phase === "ending") && (
        <>
          <video ref={screenVideoRef} autoPlay playsInline muted style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", overflow: "hidden" }} />

          {/* ── Main waveform area ── */}
          <div className="animate-fade-in" style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            opacity: phase === "ending" ? 0 : 1,
            transform: phase === "ending" ? "scale(0.95)" : "scale(1)",
            transition: "opacity 0.8s ease, transform 0.8s cubic-bezier(.22,1,.36,1)",
          }}>
            <canvas ref={waveCanvasRef} style={{ width: "min(700px, 92vw)", height: 300, display: "block" }} />
          </div>

          {/* ── Camera PiP (top-right, Zoom-style) ── */}
          <div style={{
            position: "absolute", top: 20, left: 20, zIndex: 20,
            borderRadius: 6, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#000", transition: "all 0.4s ease",
            width: isCameraOn ? (isEmbed ? 180 : 360) : 0, height: isCameraOn ? (isEmbed ? 110 : 220) : 0,
            opacity: isCameraOn ? 1 : 0,
          }}>
            <video ref={cameraVideoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            {/* Name tag */}
            {isCameraOn && (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: "16px 10px 6px", background: "linear-gradient(transparent, rgba(0,0,0,0.6))" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 400 }}>You</span>
              </div>
            )}
          </div>

          {/* ── Annotations (cursor + ripple overlay) ── */}
          <div style={{ position: "absolute", bottom: 80, left: 8, right: 8, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, pointerEvents: "none" }}>
            {annotations.map((ann) => (
              <div key={ann.id} className="animate-toast" style={{ pointerEvents: "auto", width: "100%", maxWidth: 340, borderRadius: 12, overflow: "hidden", background: "rgba(12,12,12,0.95)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                <CursorOverlay screenshot={ann.screenshot} cx={ann.cx} cy={ann.cy} isCamera={ann.isCamera} />
                <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <p style={{ fontSize: 11, fontWeight: 500, color: "rgba(255,255,255,0.6)", margin: 0 }}>{ann.label}</p>
                  <button onClick={() => setAnnotations(p=>p.filter(a=>a.id!==ann.id))} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Wait indicator */}
          {showWait && (
            <div style={{
              position: "absolute", bottom: 80, left: "50%", transform: "translateX(-50%)",
              zIndex: 30, padding: "6px 16px", borderRadius: 999,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
              fontSize: 12, color: "rgba(255,255,255,0.4)", letterSpacing: "0.04em",
              animation: "fade-in 0.2s ease, fade-out 0.3s ease 1.7s forwards",
            }}>
              Wait until N22 finishes
            </div>
          )}

          {/* ── Controls pill ── */}
          <div style={{
            position: "absolute", bottom: 20, left: "50%",
            transform: `translateX(-50%) translateY(${showControls && phase !== "ending" ? 0 : 20}px)`,
            zIndex: 30, transition: "all 0.5s cubic-bezier(.22,1,.36,1)",
            opacity: (showControls && phase !== "ending") ? (isEmbed && chatOpen ? 0 : 1) : 0,
            pointerEvents: (isEmbed && chatOpen) ? "none" as const : "auto" as const,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 12px", borderRadius: 14,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(32px)",
            }}>
              <Btn on={isMuted} color="rgba(239,68,68,0.6)" click={toggleMute}>
                {isMuted
                  ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18"/></svg>
                  : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
              </Btn>
              <Btn on={isCameraOn} color="rgba(74,222,128,0.5)" click={toggleCamera}>
                {isCameraOn
                  ? <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                  : <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>}
              </Btn>
              <Btn on={isSharing} color="rgba(74,222,128,0.5)" click={toggleScreenShare}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </Btn>
              <Btn on={chatOpen} color="rgba(255,255,255,0.15)" click={() => setChatOpen(o=>{ if (!o) setAnnotations([]); return !o; })}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </Btn>
              <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
              <button onClick={endSession} style={{
                width: 38, height: 38, borderRadius: 10,
                background: "rgba(239,68,68,0.6)", border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "background 0.2s",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background="rgba(239,68,68,0.85)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background="rgba(239,68,68,0.7)"; }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
          </div>

          {/* ── Chat panel (right side) ── */}
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: chatOpen ? chatWidth : 0,
            zIndex: isEmbed ? 35 : 25, transition: "width 0.25s cubic-bezier(.22,1,.36,1)", overflow: "hidden",
          }}>
            <div style={{
              width: chatWidth, height: "100%", display: "flex", flexDirection: "column",
              background: "rgba(10,10,10,0.97)", borderLeft: "1px solid rgba(255,255,255,0.06)",
              backdropFilter: "blur(32px)",
            }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: isEmbed ? "12px 14px" : "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize: isEmbed ? 11 : 12, fontWeight: 500, color: "rgba(255,255,255,0.4)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Chat</span>
                <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", padding: 4, borderRadius: 4, transition: "color 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(255,255,255,0.2)"; }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              {/* Messages */}
              <div className="scrollbar-hide" style={{ flex: 1, overflowY: "auto", padding: isEmbed ? "10px 14px" : "14px 20px" }}>
                {messages.length === 0 && <p style={{ color: "rgba(255,255,255,0.06)", fontSize: 11, textAlign: "center", marginTop: 40, fontWeight: 400 }}>No messages yet</p>}
                {messages.map((msg, i) => (
                  <div key={i} className="animate-msg" style={{ marginBottom: 12 }}>
                    <span style={{ fontSize: 10, fontWeight: 500, color: msg.role === "user" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.5)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      {msg.role === "user" ? "You" : "N22"}
                    </span>
                    <p style={{ fontSize: isEmbed ? 12.5 : 13.5, lineHeight: 1.5, color: msg.role === "user" ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.65)", margin: "2px 0 0", fontWeight: 400 }}>
                      {msg.text}
                    </p>
                    {msg.annotation && (
                      <div style={{ marginTop: 6, borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 2px 8px rgba(0,0,0,0.3)" }}>
                        <CursorOverlay screenshot={msg.annotation.screenshot} cx={msg.annotation.cx} cy={msg.annotation.cy} isCamera={msg.annotation.isCamera} />
                      </div>
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              {/* Input */}
              <form style={{ padding: isEmbed ? "8px 10px 12px" : "10px 16px 14px", borderTop: "1px solid rgba(255,255,255,0.04)" }}
                onSubmit={(e) => { e.preventDefault(); const t=chatInput.trim(); if (!t) return; setChatInput(""); handleUserMessage(t,"chat"); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "7px 10px", border: "1px solid rgba(255,255,255,0.04)", transition: "border-color 0.15s" }}>
                  <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message..."
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,0.7)", fontSize: 12, fontFamily: "inherit", fontWeight: 400 }} />
                  <button type="submit" style={{ width: 24, height: 24, borderRadius: 4, background: chatInput.trim() ? "rgba(255,255,255,0.1)" : "transparent", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: chatInput.trim() ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.15)", flexShrink: 0, transition: "all 0.15s" }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />
      <canvas ref={pipCanvasRef} style={{ display: "none" }} />
      <video ref={pipVideoRef} playsInline muted style={{ display: "none" }} />
    </div>
  );
}

function Btn({ on, color, click, children }: { on: boolean; color: string; click: () => void; children: React.ReactNode }) {
  return (
    <button onClick={click} style={{
      width: 38, height: 38, borderRadius: 10,
      background: on ? color : "transparent",
      border: "none", display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", transition: "all 0.15s ease",
    }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = on ? color : "transparent"; }}
    >{children}</button>
  );
}

/** Animated overlay — cursor+ripple for screen, crosshair+ring for camera */
function CursorOverlay({ screenshot, cx, cy, isCamera }: { screenshot: string; cx: number; cy: number; isCamera?: boolean }) {
  const vars = {
    "--cx": `${cx * 100}%`,
    "--cy": `${cy * 100}%`,
  } as React.CSSProperties;

  return (
    <div style={{ position: "relative", overflow: "hidden", ...vars }}>
      <img
        src={`data:image/jpeg;base64,${screenshot}`}
        alt=""
        style={{ width: "100%", display: "block", filter: "brightness(0.85)" }}
      />

      {isCamera ? (
        /* Camera: static crosshair + steady ring */
        <div style={{
          position: "absolute",
          left: `${cx * 100}%`, top: `${cy * 100}%`,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,0.7)",
            position: "absolute", top: -9, left: -9,
          }} />
          <div style={{
            width: 4, height: 4, borderRadius: "50%",
            background: "rgba(255,255,255,0.9)",
            position: "absolute", top: -2, left: -2,
          }} />
        </div>
      ) : (
        /* Screen: animated cursor + ripple */
        <>
          <div className="ripple-ring ripple-1" />
          <div className="ripple-ring ripple-2" />
          <div className="ripple-ring ripple-3" />
          <div className="cursor-animate" style={{ position: "absolute", pointerEvents: "none", marginLeft: -2, marginTop: -2 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
              <path d="M5 3l14 9-7 1.5L8.5 21z" fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinejoin="round" />
            </svg>
          </div>
        </>
      )}
    </div>
  );
}
