"use client";

import { useRef, useState, useCallback, useEffect } from "react";

type Annotation = { id: number; screenshot: string; cx: number; cy: number; label: string };
type Msg = { role: "user" | "ceres"; text: string; annotation?: { screenshot: string; cx: number; cy: number; label: string } };

const BAR_COUNT = 40;
const BAR_W = 4;
const BAR_GAP = 4;
const MAX_BAR_H = 120;

export default function Home() {
  const [phase, setPhase] = useState<"active" | "ending" | "ended">("active");
  const [isMuted, setIsMuted] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
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

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const chatWidth = isEmbed ? 260 : isMobile ? "100vw" : 380;

  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveCanvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const smoothedRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));
  const animFrameRef = useRef<number>(0);
  const lastDrawTimeRef = useRef<number>(0);
  const lastSpeakingStateRef = useRef<boolean>(false);
  const dialogueRef = useRef<{ role: string; text: string }[]>([]);
  const stepHistoryRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const isMutedRef = useRef(false);
  const sharingRef = useRef(false);
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

    const IDLE_FRAME_INTERVAL = 66; // ~15fps when idle (not speaking)

    const draw = (now: number) => {
      animFrameRef.current = requestAnimationFrame(draw);

      const isSpeaking = speakingRef.current;

      // Throttle to ~15fps when idle — no visual difference for a slow sine wave
      if (!isSpeaking) {
        const elapsed = now - lastDrawTimeRef.current;
        // Also redraw once on speaking->idle transition to clear the last frame
        if (elapsed < IDLE_FRAME_INTERVAL && lastSpeakingStateRef.current === isSpeaking) return;
      }
      lastDrawTimeRef.current = now;
      lastSpeakingStateRef.current = isSpeaking;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      const analyser = analyserRef.current;

      // Get frequency data, simulate for mobile, or generate ambient
      let hasAnalyserData = false;
      if (isSpeaking && analyser) {
        analyser.getByteFrequencyData(freqData);
        hasAnalyserData = freqData.some(v => v > 0);
      }
      // Simulate speaking bars on mobile (no analyser connected)
      if (isSpeaking && !hasAnalyserData) {
        for (let j = 0; j < BAR_COUNT; j++) {
          freqData[j] = Math.floor(50 + Math.sin(now / 180 + j * 0.5) * 35 + Math.random() * 25);
        }
      }

      const totalW = BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP;
      const startX = (w - totalW) / 2;
      const centerY = h / 2;

      for (let i = 0; i < BAR_COUNT; i++) {
        let target: number;
        if (isSpeaking) {
          target = (freqData[i] / 255) * MAX_BAR_H;
        } else {
          const t = now / 1400;
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

    animFrameRef.current = requestAnimationFrame(draw);
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

      // On mobile, skip createMediaElementSource — it hijacks audio routing through
      // AudioContext which is often suspended on mobile, producing silence.
      // On desktop, connect to analyser for real waveform visualization.
      const isMobileBrowser = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (!isMobileBrowser && audioCtxRef.current.state === "running") {
        // Disconnect previous source node
        if (sourceNodeRef.current) {
          try { sourceNodeRef.current.disconnect(); } catch {}
          sourceNodeRef.current = null;
        }
        try {
          const source = audioCtxRef.current.createMediaElementSource(audio);
          source.connect(analyserRef.current!);
          sourceNodeRef.current = source;
        } catch {
          // If connection fails, audio still plays directly
        }
      }

      const onDone = () => {
        speakingRef.current = false; setSpeaking(false); URL.revokeObjectURL(url); currentAudioRef.current = null;
        // 1s cooldown — ignore mic input briefly so TTS audio doesn't echo back
        speakingCooldownRef.current = true;
        setTimeout(() => { speakingCooldownRef.current = false; }, 1000);
      };
      audio.onended = onDone;
      audio.onerror = onDone;

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
    // Scale down for performance on mobile — full res not needed for Claude vision
    const maxW = 1280;
    const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d"); if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.4).replace(/^data:image\/\w+;base64,/, "");
  }, []);

  const showAnnotation = useCallback((screenshot: string, cx: number, cy: number, label: string) => {
    const id = ++annotationIdRef.current;
    const ann = { screenshot, cx, cy, label };
    // Only show floating toast if chat is closed — limit to 1 for performance
    if (!chatOpenRef.current) {
      setAnnotations([{ id, ...ann }]);
      setTimeout(() => setAnnotations((prev) => prev.filter((a) => a.id !== id)), 10000);
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
  }, []);

  // ── Claude ──
  const processMessage = useCallback(async (userMessage: string, isFollowUp: boolean, ssOverride?: string|null) => {
    const screenshot = ssOverride !== undefined ? ssOverride : captureFrame();
    const res = await fetch("/api/process", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ screenshot, userMessage, userName: "", dialogue: dialogueRef.current.slice(-20), stepHistory: stepHistoryRef.current, isFollowUp, customPrompt: customPromptRef.current }) });
    return res.json();
  }, [captureFrame]);

  const handleHighlight = useCallback(async (query: string, frame: string, label?: string) => {
    try {
      const vid = screenVideoRef.current;
      const imgW = vid?.videoWidth || 1920;
      const imgH = vid?.videoHeight || 1080;
      const res = await fetch("/api/grounding", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshot: frame, query, imgW, imgH }), signal: AbortSignal.timeout(14000) });
      const data = await res.json();
      console.log("[grounding] response:", JSON.stringify(data));
      if (data.cx != null) {
        const l = label || data.label || query;
        showAnnotation(frame, data.cx, data.cy, l);
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
      const ss = captureFrame();
      const r = await processMessage(text, false, ss);
      setThinking(false);
      if (!r) { processingRef.current = false; return; }
      if (r.speech) speak(r.speech);
      if (r.highlightQuery && ss) {
        handleHighlight(r.highlightQuery, ss, r.actionLabel);
      }
      if (r.speech) stepHistoryRef.current.push(r.speech);
      if (r.done || r.action === "done") stepHistoryRef.current = [];
    } catch (e) { console.error(e); setThinking(false); }
    processingRef.current = false;
  }, [processMessage, speak, captureFrame, handleHighlight]);

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

  const micDeniedRef = useRef(false);
  const restartRecRef = useRef<(() => void) | null>(null);
  const stopRecRef = useRef<(() => void) | null>(null);
  const speakingCooldownRef = useRef(false);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  // MediaRecorder fallback refs (for iOS Safari which lacks SpeechRecognition)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const usingFallbackSTTRef = useRef(false);

  const toggleMute = useCallback(async () => {
    if (isMuted && micDeniedRef.current) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        micDeniedRef.current = false;
        setIsMuted(false);
        restartRecRef.current?.();
      } catch { return; }
      return;
    }
    if (isMuted) {
      setIsMuted(false);
      restartRecRef.current?.();
    } else {
      stopRecRef.current?.();
      audioChunksRef.current = [];
      setIsMuted(true);
    }
  }, [isMuted]);

  // ── Stop/start mic input while agent speaks (echo prevention) ──
  useEffect(() => {
    if (speaking) {
      stopRecRef.current?.();
      audioChunksRef.current = [];
      if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    } else {
      const timer = setTimeout(() => { restartRecRef.current?.(); }, 1200);
      return () => clearTimeout(timer);
    }
  }, [speaking]);

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
          body: JSON.stringify({ screenshot:null, userMessage:"[Conversation just started. Introduce yourself based on your system prompt. Keep it to 2 sentences. Mention they can share their screen for visual guidance.]", userName:"", dialogue:[], stepHistory:[], isFollowUp:false, customPrompt: customPromptRef.current }) });
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
    mediaStreamRef.current?.getTracks().forEach(t=>t.stop());
    if (mediaRecorderRef.current?.state === "recording") try { mediaRecorderRef.current.stop(); } catch {}
    dialogueRef.current=[]; stepHistoryRef.current=[];
    speakingRef.current=false; processingRef.current=false;
    setChatOpen(false); setSpeaking(false); setThinking(false);
    setIsSharing(false);

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

  // ── Speech-to-text: Web Speech API (primary) or MediaRecorder + Cartesia (iOS fallback) ──
  useEffect(() => {
    if (phase !== "active") return;

    let stopped = false;
    let restartTimeout: ReturnType<typeof setTimeout> | null = null;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    // ── Primary: Web Speech API (Chrome, Edge, Safari desktop, Android) ──
    if (SR) {
      usingFallbackSTTRef.current = false;

      // Pre-request mic permission on ALL platforms for reliability
      const startWithPermission = async () => {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach(t => t.stop());
          micDeniedRef.current = false;
        } catch {
          micDeniedRef.current = true;
          setIsMuted(true);
          return;
        }

        const rec = new SR();
        rec.lang = "en-US";
        rec.interimResults = false;
        rec.continuous = true;
        rec.maxAlternatives = 1;

        rec.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (!e.results[i].isFinal) continue;
            const t = e.results[i][0].transcript.trim();
            if (!t || isMutedRef.current || speakingRef.current || speakingCooldownRef.current) continue;
            handleUserMessageRef.current(t, "voice");
          }
        };

        rec.onend = () => {
          if (stopped || speakingRef.current || speakingCooldownRef.current) return;
          restartTimeout = setTimeout(() => {
            if (!stopped && !speakingRef.current && !isMutedRef.current) try { rec.start(); } catch {}
          }, 300);
        };

        rec.onerror = (e: any) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") {
            micDeniedRef.current = true;
            setIsMuted(true);
            return;
          }
          if (stopped || speakingRef.current) return;
          restartTimeout = setTimeout(() => {
            if (!stopped && !speakingRef.current && !isMutedRef.current) try { rec.start(); } catch {}
          }, 500);
        };

        restartRecRef.current = () => {
          if (!stopped && !isMutedRef.current) try { rec.start(); } catch {}
        };
        stopRecRef.current = () => {
          try { rec.stop(); } catch {}
          if (restartTimeout) { clearTimeout(restartTimeout); restartTimeout = null; }
        };

        if (!stopped) try { rec.start(); } catch {}
      };

      startWithPermission();

      return () => {
        stopped = true;
        restartRecRef.current = null;
        stopRecRef.current = null;
        if (restartTimeout) clearTimeout(restartTimeout);
      };
    }

    // ── Fallback: MediaRecorder + Cartesia STT (iOS Safari) ──
    let recorder: MediaRecorder | null = null;
    let micStream: MediaStream | null = null;
    let vadCtx: AudioContext | null = null;
    let vadInterval: ReturnType<typeof setInterval> | null = null;
    let chosenMime = "audio/webm";
    usingFallbackSTTRef.current = true;

    const stopRec = () => {
      if (recorder?.state === "recording") try { recorder.stop(); } catch {}
    };
    const startRec = () => {
      if (stopped || isMutedRef.current || speakingRef.current || speakingCooldownRef.current) return;
      if (recorder?.state === "inactive") {
        audioChunksRef.current = [];
        try { recorder.start(250); } catch {}
      }
    };

    stopRecRef.current = stopRec;
    restartRecRef.current = startRec;

    const sendToSTT = async (chunks: Blob[]) => {
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, { type: chosenMime });
      if (blob.size < 800) return;
      try {
        const res = await fetch("/api/stt", {
          method: "POST",
          headers: { "Content-Type": chosenMime },
          body: await blob.arrayBuffer(),
        });
        const data = await res.json();
        const transcript = data.transcript?.trim();
        if (transcript && !isMutedRef.current && !speakingRef.current && !speakingCooldownRef.current) {
          handleUserMessageRef.current(transcript, "voice");
        }
      } catch (e) { console.error("[stt]", e); }
    };

    const init = async () => {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        mediaStreamRef.current = micStream;
        micDeniedRef.current = false;

        // VAD
        vadCtx = new AudioContext();
        const src = vadCtx.createMediaStreamSource(micStream);
        const analyser = vadCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        vadAnalyserRef.current = analyser;
        const freqBuf = new Uint8Array(analyser.frequencyBinCount);

        // Calibrate noise floor from first 500ms
        let noiseFloor = 15;
        setTimeout(() => {
          analyser.getByteFrequencyData(freqBuf);
          const avg = freqBuf.reduce((s, v) => s + v, 0) / freqBuf.length;
          noiseFloor = avg + 8; // threshold = ambient + margin
        }, 500);

        chosenMime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4"
          : MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
          : "audio/webm";

        recorder = new MediaRecorder(micStream, { mimeType: chosenMime });
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          const captured = [...audioChunksRef.current];
          audioChunksRef.current = [];
          if (!speakingRef.current && !speakingCooldownRef.current) sendToSTT(captured);
          if (!stopped && !speakingRef.current && !speakingCooldownRef.current && !isMutedRef.current) {
            setTimeout(startRec, 150);
          }
        };

        startRec();

        // VAD with adaptive noise floor
        vadInterval = setInterval(() => {
          if (speakingRef.current || speakingCooldownRef.current || isMutedRef.current) {
            if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
            return;
          }
          analyser.getByteFrequencyData(freqBuf);
          const avg = freqBuf.reduce((s, v) => s + v, 0) / freqBuf.length;

          if (avg > noiseFloor) {
            if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
          } else if (!silenceTimerRef.current && recorder?.state === "recording" && audioChunksRef.current.length > 0) {
            silenceTimerRef.current = setTimeout(() => {
              silenceTimerRef.current = null;
              stopRec();
            }, 1100);
          }
        }, 120);

      } catch (err: any) {
        console.error("[stt] mic init failed:", err);
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          micDeniedRef.current = true;
          setIsMuted(true);
        }
      }
    };

    init();

    return () => {
      stopped = true;
      stopRecRef.current = null;
      restartRecRef.current = null;
      usingFallbackSTTRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (vadInterval) clearInterval(vadInterval);
      if (recorder && recorder.state !== "inactive") try { recorder.stop(); } catch {}
      mediaRecorderRef.current = null;
      micStream?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      if (vadCtx) vadCtx.close().catch(() => {});
      vadAnalyserRef.current = null;
    };
  }, [phase]);

  useEffect(() => () => {
    if (currentAudioRef.current) currentAudioRef.current.pause();
    screenStreamRef.current?.getTracks().forEach(t=>t.stop());
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  // ━━━━━━━━━━━━━━━━━━━━ Render ━━━━━━━━━━━━━━━━━━━━

  return (
    <div className="h-dvh w-full relative overflow-hidden" style={{ background: "#0A0A0A", borderRadius: isEmbed ? 6 : 0 }}>

      {/* ── Ended screen ── */}
      {phase === "ended" && (
        <div style={{
          position: "absolute", inset: 0, display: "flex",
          alignItems: "center", justifyContent: "center",
        }}>
          {/* Subtle radial glow behind button */}
          <div style={{
            position: "absolute", width: 320, height: 320, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(255,255,255,0.025) 0%, transparent 65%)",
            animation: "ended-glow 5s ease-in-out infinite",
            pointerEvents: "none",
          }} />

          <button
            onClick={() => { setPhase("active"); introRanRef.current = false; }}
            style={{
              padding: "14px 36px", borderRadius: 12,
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 500,
              cursor: "pointer", transition: "all 0.25s cubic-bezier(.22,1,.36,1)",
              fontFamily: "-apple-system, 'Helvetica Neue', sans-serif", letterSpacing: "0.03em",
              animation: "ended-rise 0.6s cubic-bezier(.22,1,.36,1) both",
              backdropFilter: "blur(16px)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.13)";
              e.currentTarget.style.color = "rgba(255,255,255,0.85)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 32px rgba(255,255,255,0.04)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.07)";
              e.currentTarget.style.color = "rgba(255,255,255,0.55)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "none";
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

          {/* ── Annotations (cursor + ripple overlay) ── */}
          <div style={{ position: "absolute", bottom: 100, left: 8, right: 8, zIndex: 20, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, pointerEvents: "none" }}>
            {annotations.map((ann) => (
              <div key={ann.id} className="animate-toast" style={{ pointerEvents: "auto", width: "100%", maxWidth: 340, borderRadius: 12, overflow: "hidden", background: "rgba(12,12,12,0.95)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
                <CursorOverlay screenshot={ann.screenshot} cx={ann.cx} cy={ann.cy} />
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
              position: "absolute", bottom: 110, left: "50%", transform: "translateX(-50%)",
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
            position: "absolute", bottom: "max(20px, env(safe-area-inset-bottom, 0px))", left: "50%",
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
              <Btn on={isSharing} color="rgba(74,222,128,0.5)" click={toggleScreenShare}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              </Btn>
              <Btn on={chatOpen} color="rgba(255,255,255,0.15)" click={() => setChatOpen(o=>{ if (!o) setAnnotations([]); return !o; })}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </Btn>
              <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
              <button onClick={endSession} style={{
                width: 42, height: 42, borderRadius: 11,
                background: "rgba(239,68,68,0.6)", border: "none",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "background 0.2s",
                WebkitTapHighlightColor: "transparent",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.background="rgba(239,68,68,0.85)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background="rgba(239,68,68,0.7)"; }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4z"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
          </div>

          {/* ── Chat panel (right side, full-width on mobile) ── */}
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0,
            width: chatOpen ? (isMobile ? "100%" : chatWidth) : 0,
            zIndex: isEmbed ? 35 : isMobile ? 35 : 25,
            transition: "width 0.25s cubic-bezier(.22,1,.36,1)", overflow: "hidden",
          }}>
            <div style={{
              width: isMobile ? "100%" : chatWidth, height: "100%", display: "flex", flexDirection: "column",
              background: "rgba(10,10,10,0.97)", borderLeft: isMobile ? "none" : "1px solid rgba(255,255,255,0.06)",
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
                        <CursorOverlay screenshot={msg.annotation.screenshot} cx={msg.annotation.cx} cy={msg.annotation.cy} />
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
    </div>
  );
}

function Btn({ on, color, click, children }: { on: boolean; color: string; click: () => void; children: React.ReactNode }) {
  return (
    <button onClick={click} style={{
      width: 42, height: 42, borderRadius: 11,
      background: on ? color : "transparent",
      border: "none", display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", transition: "all 0.15s ease",
      WebkitTapHighlightColor: "transparent",
    }}
      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background="rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = on ? color : "transparent"; }}
    >{children}</button>
  );
}

/** Animated overlay — cursor+ripple for screen */
function CursorOverlay({ screenshot, cx, cy }: { screenshot: string; cx: number; cy: number }) {
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

      <div className="ripple-ring ripple-1" />
      <div className="ripple-ring ripple-2" />
      <div className="ripple-ring ripple-3" />
      <div className="cursor-animate" style={{ position: "absolute", pointerEvents: "none", marginLeft: -2, marginTop: -2 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}>
          <path d="M5 3l14 9-7 1.5L8.5 21z" fill="white" stroke="rgba(0,0,0,0.4)" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
