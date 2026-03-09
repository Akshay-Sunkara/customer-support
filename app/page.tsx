"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Daily, { DailyCall } from "@daily-co/daily-js";

type Annotation = { id: number; image: string; label: string; instruction: string };

export default function Home() {
  const [phase, setPhase] = useState<"idle" | "connecting" | "active">("connecting");
  const [isMuted, setIsMuted] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ceres"; text: string }[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const pendingVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pipRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const annotationIdRef = useRef(0);

  const dialogueRef = useRef<{ role: string; text: string }[]>([]);
  const stepHistoryRef = useRef<string[]>([]);
  const usedQueriesRef = useRef<string[]>([]);
  const taskActiveRef = useRef(false);
  const processingRef = useRef(false);
  const continueResolveRef = useRef<(() => void) | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sharingRef = useRef(false);
  const cameraOnRef = useRef(false);
  const avatarSpeakingRef = useRef(false);
  const avatarSpeakingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAvatarTextRef = useRef("");
  const muteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { sharingRef.current = isSharing; }, [isSharing]);
  useEffect(() => { cameraOnRef.current = isCameraOn; }, [isCameraOn]);

  const resetControlsTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (!chatOpen) setShowControls(false);
    }, 3500);
  }, [chatOpen]);

  useEffect(() => {
    if (phase !== "active") return;
    const handler = () => resetControlsTimer();
    window.addEventListener("mousemove", handler);
    window.addEventListener("touchstart", handler);
    resetControlsTimer();
    return () => {
      window.removeEventListener("mousemove", handler);
      window.removeEventListener("touchstart", handler);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [phase, resetControlsTimer]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen]);

  // --- Tavus echo (persona is in echo mode — avatar only speaks what we send) ---
  const tellTavus = useCallback((text: string) => {
    const call = callRef.current;
    const convId = conversationIdRef.current;
    if (!call || !convId) return;

    lastAvatarTextRef.current = text;

    call.sendAppMessage({
      message_type: "conversation",
      event_type: "conversation.echo",
      conversation_id: convId,
      properties: { text },
    }, "*");
    dialogueRef.current.push({ role: "ceres", text });
    setMessages((prev) => [...prev, { role: "ceres", text }]);
  }, []);

  // --- Screen capture ---
  const captureFrame = useCallback((): string | null => {
    if (!sharingRef.current) return null;
    const video = screenVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.5).replace(/^data:image\/\w+;base64,/, "");
  }, []);

  // --- Camera capture ---
  const captureCameraFrame = useCallback((): string | null => {
    if (!cameraOnRef.current) return null;
    const video = cameraVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85).replace(/^data:image\/\w+;base64,/, "");
  }, []);

  // --- Draw annotation on screenshot (minimalist) ---
  const drawAnnotation = useCallback((
    screenshotB64: string,
    cx: number, cy: number,
    isCamera: boolean,
    box?: { x: number; y: number; w: number; h: number },
  ): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);

        const lineW = Math.max(1.5, Math.round(c.width * 0.002));

        if (box) {
          const bx = box.x * c.width;
          const by = box.y * c.height;
          const bw = box.w * c.width;
          const bh = box.h * c.height;
          const cornerR = Math.max(4, Math.min(bw, bh) * 0.06);

          // Subtle darkened background
          ctx.save();
          ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
          ctx.beginPath();
          ctx.rect(0, 0, c.width, c.height);
          ctx.moveTo(bx + cornerR, by);
          ctx.lineTo(bx + bw - cornerR, by);
          ctx.arcTo(bx + bw, by, bx + bw, by + cornerR, cornerR);
          ctx.lineTo(bx + bw, by + bh - cornerR);
          ctx.arcTo(bx + bw, by + bh, bx + bw - cornerR, by + bh, cornerR);
          ctx.lineTo(bx + cornerR, by + bh);
          ctx.arcTo(bx, by + bh, bx, by + bh - cornerR, cornerR);
          ctx.lineTo(bx, by + cornerR);
          ctx.arcTo(bx, by, bx + cornerR, by, cornerR);
          ctx.closePath();
          ctx.fill("evenodd");
          ctx.restore();

          // White outline
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(bx + cornerR, by);
          ctx.lineTo(bx + bw - cornerR, by);
          ctx.arcTo(bx + bw, by, bx + bw, by + cornerR, cornerR);
          ctx.lineTo(bx + bw, by + bh - cornerR);
          ctx.arcTo(bx + bw, by + bh, bx + bw - cornerR, by + bh, cornerR);
          ctx.lineTo(bx + cornerR, by + bh);
          ctx.arcTo(bx, by + bh, bx, by + bh - cornerR, cornerR);
          ctx.lineTo(bx, by + cornerR);
          ctx.arcTo(bx, by, bx + cornerR, by, cornerR);
          ctx.closePath();
          ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
          ctx.lineWidth = lineW;
          ctx.stroke();
          ctx.restore();
        } else if (!isCamera) {
          // Screen mode: cursor
          const sx = cx * c.width;
          const sy = cy * c.height;
          const s = Math.max(c.width, c.height) * 0.022;
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx, sy + s * 1.45);
          ctx.lineTo(sx + s * 0.4, sy + s * 1.1);
          ctx.lineTo(sx + s * 0.75, sy + s * 1.55);
          ctx.lineTo(sx + s * 0.95, sy + s * 1.4);
          ctx.lineTo(sx + s * 0.55, sy + s * 0.95);
          ctx.lineTo(sx + s * 1.0, sy + s * 0.95);
          ctx.closePath();
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
          ctx.shadowBlur = s * 0.4;
          ctx.fill();
          ctx.shadowColor = "transparent";
          ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
          ctx.lineWidth = Math.max(1, s * 0.06);
          ctx.lineJoin = "round";
          ctx.stroke();
          ctx.restore();
        } else {
          // Camera no-box: small crosshair dot
          const sx = cx * c.width;
          const sy = cy * c.height;
          const r = Math.max(c.width, c.height) * 0.012;
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
          ctx.lineWidth = lineW;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx, sy, r * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.fill();
          ctx.restore();
        }

        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = `data:image/jpeg;base64,${screenshotB64}`;
    });
  }, []);

  // --- Show annotation card ---
  const showAnnotation = useCallback((image: string, label: string, instruction: string) => {
    setChatOpen(false);
    const id = ++annotationIdRef.current;
    setAnnotations((prev) => {
      const next = [...prev, { id, image, label, instruction }];
      // Keep only the latest 3
      return next.slice(-3);
    });
    // Auto-dismiss after 20 seconds
    setTimeout(() => {
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
    }, 20000);
  }, []);

  // --- Process message via Claude ---
  const processMessage = useCallback(async (userMessage: string, isFollowUp: boolean, screenshotOverride?: string | null) => {
    const screenshot = screenshotOverride !== undefined ? screenshotOverride : captureFrame();
    const cameraFrame = captureCameraFrame();

    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot,
        cameraFrame,
        userMessage,
        userName: "",
        dialogue: dialogueRef.current.slice(-20),
        stepHistory: stepHistoryRef.current,
        isFollowUp,
      }),
    });

    return res.json();
  }, [captureFrame, captureCameraFrame]);

  // --- Highlight (screen or camera) ---
  const handleHighlight = useCallback(async (highlightQuery: string, frameB64: string, isCamera: boolean, actionLabel?: string, speechText?: string) => {
    try {
      const vid = isCamera ? cameraVideoRef.current : screenVideoRef.current;
      const imgW = vid?.videoWidth || (isCamera ? 1280 : 1920);
      const imgH = vid?.videoHeight || (isCamera ? 720 : 1080);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 14000);

      const res = await fetch("/api/grounding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenshot: frameB64, query: highlightQuery, imgW, imgH, isCamera }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();

      if (data.cx != null) {
        const label = data.label || actionLabel || highlightQuery;
        const instruction = speechText || actionLabel || highlightQuery;
        const annotated = await drawAnnotation(frameB64, data.cx, data.cy, isCamera, data.box);
        showAnnotation(annotated, label, instruction);
      }
    } catch (e) {
      console.warn("[highlight] Failed:", e);
    }
  }, [drawAnnotation, showAnnotation]);

  // --- Handle user message ---
  const handleUserMessage = useCallback(async (text: string) => {
    if (processingRef.current) return;
    dialogueRef.current.push({ role: "user", text });
    setMessages((prev) => [...prev, { role: "user", text }]);

    if (continueResolveRef.current && taskActiveRef.current) {
      const resolve = continueResolveRef.current;
      continueResolveRef.current = null;
      resolve();
      return;
    }

    processingRef.current = true;

    try {
      const screenshot = captureFrame();
      const cameraFrame = captureCameraFrame();
      const response = await processMessage(text, taskActiveRef.current, screenshot);
      if (!response) { processingRef.current = false; return; }

      if (response.speech) tellTavus(response.speech);

      if (response.highlightQuery) {
        const wantsCamera = response.highlightSource === "camera";
        if (wantsCamera && cameraFrame) {
          handleHighlight(response.highlightQuery, cameraFrame, true, response.actionLabel, response.speech).catch(console.error);
        } else if (!wantsCamera && screenshot) {
          handleHighlight(response.highlightQuery, screenshot, false, response.actionLabel, response.speech).catch(console.error);
        } else if (screenshot) {
          handleHighlight(response.highlightQuery, screenshot, false, response.actionLabel, response.speech).catch(console.error);
        } else if (cameraFrame) {
          handleHighlight(response.highlightQuery, cameraFrame, true, response.actionLabel, response.speech).catch(console.error);
        }
      } else if (cameraFrame && !screenshot) {
        // Camera is on but Claude didn't call the tool — check if user asked to find/pinpoint something
        const lower = text.toLowerCase();
        const triggerWords = ["pinpoint", "find", "where", "show me", "point", "highlight", "locate", "which", "identify"];
        if (triggerWords.some((w) => lower.includes(w))) {
          // Force grounding using the user's original query
          handleHighlight(text, cameraFrame, true, response.actionLabel || undefined, response.speech).catch(console.error);
        }
      }

      if (response.speech) stepHistoryRef.current.push(response.speech);

      if (response.done || response.action === "done") {
        taskActiveRef.current = false;
        stepHistoryRef.current = [];
        usedQueriesRef.current = [];
      }
    } catch (e) {
      console.error(e);
    }

    processingRef.current = false;
  }, [processMessage, tellTavus, captureFrame, captureCameraFrame, handleHighlight]);

  // --- Screen share toggle ---
  const toggleScreenShare = useCallback(async () => {
    if (isSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }
      setIsSharing(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = stream;
      if (screenVideoRef.current) screenVideoRef.current.srcObject = stream;
      stream.getVideoTracks()[0].onended = () => { screenStreamRef.current = null; setIsSharing(false); };
      setIsSharing(true);
    } catch {}
  }, [isSharing]);

  // --- Camera toggle ---
  const toggleCamera = useCallback(async () => {
    if (isCameraOn) {
      if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null; }
      if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
      setIsCameraOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = stream; cameraVideoRef.current.play().catch(() => {}); }
      setIsCameraOn(true);
    } catch {}
  }, [isCameraOn, cameraFacing]);

  // --- Camera flip ---
  const flipCamera = useCallback(async () => {
    const newFacing = cameraFacing === "environment" ? "user" : "environment";
    setCameraFacing(newFacing);
    if (!isCameraOn) return;
    if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newFacing, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) { cameraVideoRef.current.srcObject = stream; cameraVideoRef.current.play().catch(() => {}); }
    } catch {}
  }, [cameraFacing, isCameraOn]);

  // --- Start session ---
  const startSession = useCallback(async () => {
    setPhase("connecting");
    try {
      let micStream: MediaStream | null = null;
      try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); } catch {}

      const res = await fetch("/api/tavus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: "" }),
      });
      const data = await res.json();
      if (data.error) { micStream?.getTracks().forEach((t) => t.stop()); setPhase("idle"); return; }

      conversationIdRef.current = data.conversation_id;
      const url = data.conversation_url;
      if (!url) { micStream?.getTracks().forEach((t) => t.stop()); setPhase("idle"); return; }

      micStream?.getTracks().forEach((t) => t.stop());

      // Get mic with echo cancellation constraints
      let audioSource: MediaStreamTrack | boolean = true;
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        audioSource = micStream.getAudioTracks()[0] || true;
      } catch (e) {
        console.warn("[mic] Failed to get constrained audio, falling back:", e);
      }
      const call = Daily.createCallObject({ videoSource: false, audioSource });
      callRef.current = call;

      call.on("track-started", (event: any) => {
        if (event.participant?.local) return;
        if (event.track.kind === "video") { pendingVideoTrackRef.current = event.track; setPhase("active"); }
        if (event.track.kind === "audio") {
          if (!audioElRef.current) {
            audioElRef.current = document.createElement("audio");
            audioElRef.current.autoplay = true;
            audioElRef.current.setAttribute("playsinline", "");
            audioElRef.current.volume = 1.0;
            document.body.appendChild(audioElRef.current);
          }
          audioElRef.current.srcObject = new MediaStream([event.track]);
          audioElRef.current.play().catch(() => {
            const resume = () => { audioElRef.current?.play().catch(() => {}); document.removeEventListener("click", resume); document.removeEventListener("touchstart", resume); };
            document.addEventListener("click", resume);
            document.addEventListener("touchstart", resume);
          });
        }
      });

      call.on("error", (event: any) => {
        const msg = JSON.stringify(event);
        if (msg.includes("timed out") || msg.includes("lookup") || msg.includes("signaling")) {
          try { call.leave(); call.destroy(); } catch {}
          setTimeout(() => {
            if (conversationIdRef.current) {
              const retry = Daily.createCallObject({ videoSource: false, audioSource: true });
              callRef.current = retry;
              retry.join({ url });
            }
          }, 4000);
        }
      });

      await new Promise((r) => setTimeout(r, 3000));
      await call.join({ url });
      call.setLocalAudio(true);
    } catch {
      setPhase("idle");
    }
  }, []);

  // Attach tracks on active
  useEffect(() => {
    if (phase === "active") {
      if (avatarVideoRef.current && pendingVideoTrackRef.current) {
        avatarVideoRef.current.srcObject = new MediaStream([pendingVideoTrackRef.current]);
        pendingVideoTrackRef.current = null;
      }
      const timer = setTimeout(async () => {
        const res = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshot: null, cameraFrame: null,
            userMessage: "[Conversation just started. Introduce yourself warmly as Ceres. Tell the user you are here to help. Mention that if they need help navigating something on their computer, they can share their screen. If they need help with physical hardware, they can share their camera and you can point out buttons, ports, and components. Keep it brief and friendly.]",
            userName: "", dialogue: [], stepHistory: [], isFollowUp: false,
          }),
        });
        const data = await res.json();
        if (data.speech) tellTavus(data.speech);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, tellTavus]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (callRef.current) { callRef.current.leave().catch(() => {}); callRef.current.destroy(); }
      if (conversationIdRef.current) { fetch("/api/tavus-end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversationIdRef.current }) }).catch(() => {}); }
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop());
      if (cameraStreamRef.current) cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.remove(); audioElRef.current = null; }
    };
  }, []);

  // Auto-start
  useEffect(() => { startSession(); }, [startSession]);

  const isMutedRef = useRef(false);
  const toggleMute = useCallback(() => {
    // Debounce rapid toggles (300ms)
    if (muteDebounceRef.current) return;
    muteDebounceRef.current = setTimeout(() => { muteDebounceRef.current = null; }, 300);

    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    try {
      callRef.current?.setLocalAudio(!next);
      // Verify actual state and force correction on mismatch
      const actual = callRef.current?.localAudio();
      if (actual === next) {
        console.warn("[mute] State mismatch, forcing:", next ? "muted" : "unmuted");
        callRef.current?.setLocalAudio(!next);
      }
    } catch (e) {
      console.warn("[mute] setLocalAudio failed:", e);
    }
    console.log("[mute]", next ? "Muted" : "Unmuted");
  }, []);

  const endSession = useCallback(() => {
    taskActiveRef.current = false;
    if (continueResolveRef.current) { continueResolveRef.current(); continueResolveRef.current = null; }
    if (callRef.current) { callRef.current.leave().catch(() => {}); callRef.current.destroy(); callRef.current = null; }
    if (conversationIdRef.current) { fetch("/api/tavus-end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversationIdRef.current }) }).catch(() => {}); conversationIdRef.current = null; }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; }
    if (cameraStreamRef.current) { cameraStreamRef.current.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null; }
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current.remove(); audioElRef.current = null; }
    dialogueRef.current = []; stepHistoryRef.current = []; usedQueriesRef.current = [];
    avatarSpeakingRef.current = false; lastAvatarTextRef.current = "";
    if (avatarSpeakingTimerRef.current) clearTimeout(avatarSpeakingTimerRef.current);
    if (muteDebounceRef.current) { clearTimeout(muteDebounceRef.current); muteDebounceRef.current = null; }
    setMessages([]); setAnnotations([]); setIsSharing(false); setIsCameraOn(false); setChatOpen(false); setPhase("idle");
  }, []);

  // Voice input from Tavus
  useEffect(() => {
    const call = callRef.current;
    if (!call || phase !== "active") return;
    const handler = (event: any) => {
      try {
        const msg = event?.data || event;

        // Avatar started speaking — mute mic to prevent echo pickup
        if (msg?.event_type === "conversation.replica.started_speaking") {
          avatarSpeakingRef.current = true;
          if (avatarSpeakingTimerRef.current) clearTimeout(avatarSpeakingTimerRef.current);
          if (!isMutedRef.current && callRef.current) {
            callRef.current.setLocalAudio(false);
          }
          console.log("[tavus] Replica started speaking, mic muted");
          return;
        }

        // Avatar finished speaking (utterance event or stopped speaking) — restore mic after cooldown
        if (
          (msg?.event_type === "conversation.utterance" && msg?.properties?.role !== "user") ||
          msg?.event_type === "conversation.replica.stopped_speaking"
        ) {
          if (avatarSpeakingTimerRef.current) clearTimeout(avatarSpeakingTimerRef.current);
          avatarSpeakingTimerRef.current = setTimeout(() => {
            avatarSpeakingRef.current = false;
            lastAvatarTextRef.current = "";
            if (!isMutedRef.current && callRef.current) {
              callRef.current.setLocalAudio(true);
            }
            console.log("[tavus] Replica done speaking, mic restored");
          }, 1000); // 1s cooldown for echo tail
          return;
        }

        // User speech transcription
        if (msg?.event_type === "conversation.utterance" && msg?.properties?.role === "user") {
          const text = msg.properties.speech || "";
          if (!text) return;

          // Reject while muted or avatar is speaking (mic should be off, but reject any leakage)
          if (isMutedRef.current || avatarSpeakingRef.current) {
            console.log("[voice] Rejected (" + (isMutedRef.current ? "muted" : "avatar speaking") + "):", text.slice(0, 50));
            return;
          }

          handleUserMessage(text);
        }
      } catch {}
    };
    call.on("app-message", handler);
    return () => { call.off("app-message", handler); };
  }, [phase, handleUserMessage]);

  return (
    <div className="h-dvh w-full bg-[#080808] relative overflow-hidden">

      {/* --- Idle (rejoin) --- */}
      {phase === "idle" && (
        <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
          <button
            onClick={startSession}
            className="w-16 h-16 rounded-full border border-white/10 hover:border-white/20 flex items-center justify-center transition-all cursor-pointer hover:bg-white/[0.04]"
          >
            <svg className="w-6 h-6 ml-1" viewBox="0 0 24 24" fill="white" fillOpacity="0.4">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
        </div>
      )}

      {/* --- Connecting --- */}
      {phase === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
          <div className="w-16 h-16 rounded-full border-2 border-white/[0.06] border-t-white/30 animate-spin" />
        </div>
      )}

      {/* --- Active --- */}
      {phase === "active" && (
        <>
          <video ref={avatarVideoRef} autoPlay playsInline className="absolute inset-0 w-full h-full object-cover animate-fade-in" />

          {/* Screen video — always hidden (used for frame capture only) */}
          <video ref={screenVideoRef} autoPlay playsInline muted className="hidden" />

          {/* Camera PiP — draggable */}
          <div
            ref={pipRef}
            className={`absolute z-20 transition-opacity duration-300 ${isCameraOn ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            style={{ top: 20, right: 20, cursor: "grab" }}
            onMouseDown={(e) => {
              const el = pipRef.current; if (!el) return;
              draggingRef.current = true;
              const rect = el.getBoundingClientRect();
              dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
              const onMove = (ev: MouseEvent) => { if (!draggingRef.current) return; el.style.left = `${ev.clientX - dragOffsetRef.current.x}px`; el.style.top = `${ev.clientY - dragOffsetRef.current.y}px`; el.style.right = "auto"; };
              const onUp = () => { draggingRef.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
              window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
            }}
            onTouchStart={(e) => {
              const el = pipRef.current; if (!el) return;
              draggingRef.current = true;
              const touch = e.touches[0]; const rect = el.getBoundingClientRect();
              dragOffsetRef.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
              const onMove = (ev: TouchEvent) => { if (!draggingRef.current) return; const t = ev.touches[0]; el.style.left = `${t.clientX - dragOffsetRef.current.x}px`; el.style.top = `${t.clientY - dragOffsetRef.current.y}px`; el.style.right = "auto"; };
              const onEnd = () => { draggingRef.current = false; window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onEnd); };
              window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onEnd);
            }}
          >
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.1]" style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
              <video ref={cameraVideoRef} autoPlay playsInline muted className="w-48 h-36 sm:w-64 sm:h-48 object-cover bg-black" />
              <button
                onClick={(e) => { e.stopPropagation(); flipCamera(); }}
                className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
              </button>
            </div>
          </div>

          {/* Vignette */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/50 via-transparent to-black/20" />

          {/* Annotation cards — full-width above controls on mobile, right-side on desktop */}
          <div className="absolute bottom-20 left-2 right-2 sm:bottom-6 sm:left-auto sm:right-5 z-20 flex flex-col items-stretch sm:items-end gap-2.5 pointer-events-none sm:max-w-[320px]">
            {annotations.map((ann) => (
              <div
                key={ann.id}
                className="animate-toast pointer-events-auto w-full rounded-xl overflow-hidden backdrop-blur-xl"
                style={{ background: "rgba(12,12,12,0.92)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 4px 24px rgba(0,0,0,0.4)" }}
              >
                <div className="relative">
                  <img
                    src={ann.image}
                    alt=""
                    className="w-full aspect-video object-cover"
                  />
                  <button
                    onClick={() => setAnnotations((prev) => prev.filter((a) => a.id !== ann.id))}
                    className="absolute top-1.5 right-1.5 w-6 h-6 sm:w-5 sm:h-5 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 transition-colors cursor-pointer"
                  >
                    <svg className="w-3 h-3 sm:w-2.5 sm:h-2.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-[11px] font-medium text-white/60 tracking-wide uppercase mb-1">{ann.label}</p>
                  <p className="text-[12px] text-white/40 leading-relaxed">{ann.instruction}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Controls pill */}
          <div className={`absolute bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 transition-all duration-500 z-30 ${showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}>
            <div className="flex items-center gap-0.5 sm:gap-1 px-1.5 sm:px-2 py-1.5 sm:py-2 rounded-full backdrop-blur-2xl" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <button onClick={toggleMute} className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${isMuted ? "bg-red-500/60 hover:bg-red-500/70" : "hover:bg-white/10"}`}>
                {isMuted ? (
                  <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18" /></svg>
                ) : (
                  <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                )}
              </button>

              <button onClick={toggleCamera} className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${isCameraOn ? "bg-green-500/50 hover:bg-green-500/60" : "hover:bg-white/10"}`}>
                {isCameraOn ? (
                  <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                ) : (
                  <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                )}
              </button>

              <button onClick={toggleScreenShare} className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${isSharing ? "bg-green-500/50 hover:bg-green-500/60" : "hover:bg-white/10"}`}>
                <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
              </button>

              <button onClick={() => setChatOpen((o) => { if (!o) setAnnotations([]); return !o; })} className={`w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${chatOpen ? "bg-white/15" : "hover:bg-white/10"}`}>
                <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              </button>

              <div className="w-px h-5 bg-white/10 mx-0.5 sm:mx-1" />

              <button onClick={endSession} className="w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center rounded-full bg-red-500/70 hover:bg-red-500/85 transition-all cursor-pointer">
                <svg className="w-4 h-4 sm:w-[17px] sm:h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4z" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
              </button>
            </div>
          </div>

          {/* Chat panel */}
          <div
            className={`absolute bottom-16 sm:bottom-[90px] left-2 right-2 sm:left-1/2 sm:-translate-x-1/2 sm:w-[360px] max-h-[60vh] sm:max-h-[420px] flex flex-col rounded-2xl overflow-hidden backdrop-blur-2xl transition-all duration-300 ease-out z-20 ${chatOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95 pointer-events-none"}`}
            style={{ background: "rgba(10,10,10,0.92)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
              <span className="text-[11px] font-medium text-white/40 tracking-widest uppercase">Chat</span>
              <button onClick={() => setChatOpen(false)} className="text-white/25 hover:text-white/50 transition-colors cursor-pointer">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[160px] sm:min-h-[200px] scrollbar-hide">
              {messages.length === 0 && <p className="text-white/15 text-xs text-center mt-14">Send a message to Ceres</p>}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed animate-msg ${msg.role === "user" ? "bg-white/10 text-white/80 rounded-br-md" : "bg-white/[0.04] text-white/55 rounded-bl-md"}`}>{msg.text}</div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form className="px-3 pb-4 sm:pb-8 pt-1" onSubmit={(e) => { e.preventDefault(); const text = chatInput.trim(); if (!text) return; setChatInput(""); handleUserMessage(text); }}>
              <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-3 py-2 border border-white/[0.05] focus-within:border-white/15 transition-colors">
                <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="Message..." className="flex-1 bg-transparent text-[16px] sm:text-sm text-white placeholder-white/20 outline-none" />
                <button type="submit" className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8 hover:bg-white/15 transition-colors cursor-pointer flex-shrink-0">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
