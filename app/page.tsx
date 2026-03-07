"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import Daily, { DailyCall } from "@daily-co/daily-js";

export default function Home() {
  const [phase, setPhase] = useState<"loading" | "connecting" | "active">("loading");
  const [isMuted, setIsMuted] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "ceres"; text: string }[]>([]);
  const [showControls, setShowControls] = useState(true);

  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const pendingVideoTrackRef = useRef<MediaStreamTrack | null>(null);

  const dialogueRef = useRef<{ role: string; text: string }[]>([]);
  const stepHistoryRef = useRef<string[]>([]);
  const usedQueriesRef = useRef<string[]>([]);
  const taskActiveRef = useRef(false);
  const processingRef = useRef(false);
  const continueResolveRef = useRef<(() => void) | null>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const sharingRef = useRef(false);

  // Keep ref in sync
  useEffect(() => { sharingRef.current = isSharing; }, [isSharing]);

  // Auto-hide controls
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
    resetControlsTimer();
    return () => {
      window.removeEventListener("mousemove", handler);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [phase, resetControlsTimer]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatOpen]);

  // --- Tavus echo ---

  const tellTavus = useCallback((text: string) => {
    const call = callRef.current;
    const convId = conversationIdRef.current;
    if (!call || !convId) return;
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

  // --- Process message via Claude ---

  const processMessage = useCallback(async (userMessage: string, isFollowUp: boolean) => {
    const screenshot = captureFrame();

    const res = await fetch("/api/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot,
        userMessage,
        dialogue: dialogueRef.current.slice(-20),
        stepHistory: stepHistoryRef.current,
        isFollowUp,
      }),
    });

    return res.json();
  }, [captureFrame]);

  // --- Grounding ---

  const runGrounding = useCallback(async (query: string) => {
    const screenshot = captureFrame();
    if (!screenshot) return null;

    const video = screenVideoRef.current;
    const res = await fetch("/api/grounding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        screenshot,
        query,
        imgW: video?.videoWidth || 1920,
        imgH: video?.videoHeight || 1080,
      }),
    });

    const data = await res.json();
    return data.x != null ? data : null;
  }, [captureFrame]);

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
      const response = await processMessage(text, taskActiveRef.current);
      if (!response) { processingRef.current = false; return; }

      if (response.speech) tellTavus(response.speech);

      if (response.action === "click" && response.groundingQuery && sharingRef.current) {
        await runGrounding(response.groundingQuery);
      }

      if (response.action !== "none" && response.action !== "done" && !response.done) {
        taskActiveRef.current = true;
        if (response.speech) stepHistoryRef.current.push(response.speech);
        if (response.groundingQuery) usedQueriesRef.current.push(response.groundingQuery.toLowerCase());
        processingRef.current = false;
        runTaskLoop();
        return;
      }

      if (response.done || response.action === "done") {
        taskActiveRef.current = false;
        stepHistoryRef.current = [];
        usedQueriesRef.current = [];
      }
    } catch (e) {
      console.error(e);
    }

    processingRef.current = false;
  }, [processMessage, tellTavus, runGrounding]);

  // --- Task loop ---

  const runTaskLoop = useCallback(async () => {
    for (let i = 0; i < 20 && taskActiveRef.current; i++) {
      await new Promise<void>((resolve) => { continueResolveRef.current = resolve; });
      if (!taskActiveRef.current) break;

      processingRef.current = true;
      await new Promise((r) => setTimeout(r, 300));

      const response = await processMessage("[User is ready for the next step]", true);
      if (!response) { processingRef.current = false; break; }

      if (response.speech) {
        tellTavus(response.speech);
        stepHistoryRef.current.push(response.speech);
      }

      if (response.action === "click" && response.groundingQuery && sharingRef.current) {
        const qLower = response.groundingQuery.toLowerCase();
        if (!usedQueriesRef.current.some((q) => q.includes(qLower) || qLower.includes(q))) {
          await runGrounding(response.groundingQuery);
          usedQueriesRef.current.push(qLower);
        }
      }

      if (response.done || response.action === "done") {
        taskActiveRef.current = false;
        stepHistoryRef.current = [];
        usedQueriesRef.current = [];
        processingRef.current = false;
        return;
      }

      processingRef.current = false;
    }
  }, [processMessage, tellTavus, runGrounding]);

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
      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
      stream.getVideoTracks()[0].onended = () => {
        screenStreamRef.current = null;
        setIsSharing(false);
      };
      setIsSharing(true);
    } catch {
      // User cancelled
    }
  }, [isSharing]);

  // --- Start session ---

  const startSession = useCallback(async () => {
    setPhase("connecting");

    try {
      const res = await fetch("/api/tavus", { method: "POST" });
      const data = await res.json();
      if (data.error) { console.error("[tavus]", data.error); return; }

      conversationIdRef.current = data.conversation_id;
      const url = data.conversation_url;
      console.log("[tavus] conv_id:", data.conversation_id, "url:", url);

      if (!url) {
        console.error("[tavus] No conversation_url in response:", data);
        setPhase("loading");
        return;
      }

      const call = Daily.createCallObject({
        videoSource: false,
        audioSource: true,
      });
      callRef.current = call;

      call.on("track-started", (event: any) => {
        if (event.participant?.local) return;
        if (event.track.kind === "video") {
          pendingVideoTrackRef.current = event.track;
          setPhase("active");
        }
        if (event.track.kind === "audio") {
          const audio = document.createElement("audio");
          audio.srcObject = new MediaStream([event.track]);
          audio.autoplay = true;
          audio.volume = 1.0;
          document.body.appendChild(audio);
        }
      });

      call.on("error", (event: any) => {
        console.error("[daily]", event);
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

      // Wait for room to provision
      await new Promise((r) => setTimeout(r, 3000));
      await call.join({ url });
    } catch (e) {
      console.error("[connect]", e);
    }
  }, []);

  // Attach tracks on active
  useEffect(() => {
    if (phase === "active") {
      if (avatarVideoRef.current && pendingVideoTrackRef.current) {
        avatarVideoRef.current.srcObject = new MediaStream([pendingVideoTrackRef.current]);
        pendingVideoTrackRef.current = null;
      }
      // Intro: ask about screen sharing
      const timer = setTimeout(async () => {
        const res = await fetch("/api/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshot: null,
            userMessage: "[Conversation just started. Introduce yourself warmly as Ceres. Tell the user you are here to help. Mention that if they need help navigating something on their computer, they can share their screen using the monitor button at the bottom. Keep it brief and friendly.]",
            dialogue: [],
            stepHistory: [],
            isFollowUp: false,
          }),
        });
        const data = await res.json();
        if (data.speech) tellTavus(data.speech);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, tellTavus]);

  // Auto-start
  useEffect(() => {
    const timer = setTimeout(() => startSession(), 2000);
    return () => clearTimeout(timer);
  }, [startSession]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (callRef.current) {
        callRef.current.leave().catch(() => {});
        callRef.current.destroy();
      }
      if (conversationIdRef.current) {
        fetch("/api/tavus-end", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversationIdRef.current }),
        }).catch(() => {});
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Mute toggle
  const toggleMute = useCallback(() => {
    setIsMuted((m) => {
      const next = !m;
      // Mute local mic only (so avatar can't hear us)
      const call = callRef.current;
      if (call) call.setLocalAudio(!next);
      return next;
    });
  }, []);

  // End session
  const endSession = useCallback(() => {
    taskActiveRef.current = false;
    if (continueResolveRef.current) { continueResolveRef.current(); continueResolveRef.current = null; }
    if (callRef.current) { callRef.current.leave().catch(() => {}); callRef.current.destroy(); callRef.current = null; }
    if (conversationIdRef.current) {
      fetch("/api/tavus-end", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: conversationIdRef.current }) }).catch(() => {});
      conversationIdRef.current = null;
    }
    if (screenStreamRef.current) { screenStreamRef.current.getTracks().forEach((t) => t.stop()); screenStreamRef.current = null; }
    dialogueRef.current = [];
    stepHistoryRef.current = [];
    usedQueriesRef.current = [];
    setMessages([]);
    setIsSharing(false);
    setChatOpen(false);
    setPhase("loading");
  }, []);

  // Voice input from Tavus
  useEffect(() => {
    const call = callRef.current;
    if (!call || phase !== "active") return;

    const handler = (event: any) => {
      try {
        const msg = event?.data || event;
        if (msg?.event_type === "conversation.utterance" && msg?.properties?.role === "user") {
          const text = msg.properties.speech || "";
          if (text) handleUserMessage(text);
        }
      } catch {}
    };

    call.on("app-message", handler);
    return () => { call.off("app-message", handler); };
  }, [phase, handleUserMessage]);

  return (
    <div className="h-dvh w-full bg-[#050505] relative overflow-hidden">

      {/* --- Loading / Connecting --- */}
      {(phase === "loading" || phase === "connecting") && (
        <div className="absolute inset-0 flex items-center justify-center animate-fade-in">
          <div className="relative w-48 h-48">
            {/* Core dot */}
            <div className="absolute top-1/2 left-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full bg-white animate-core" />
            {/* Expanding pulse rings */}
            <div className="absolute top-1/2 left-1/2 w-24 h-24 -ml-12 -mt-12 rounded-full border-2 border-white/40 animate-ring-pulse-1" />
            <div className="absolute top-1/2 left-1/2 w-24 h-24 -ml-12 -mt-12 rounded-full border-2 border-white/40 animate-ring-pulse-2" />
            <div className="absolute top-1/2 left-1/2 w-24 h-24 -ml-12 -mt-12 rounded-full border-2 border-white/40 animate-ring-pulse-3" />
            {/* Slow rotating outer ring */}
            <div className="absolute top-1/2 left-1/2 w-44 h-44 -ml-[88px] -mt-[88px] rounded-full border border-white/[0.06] animate-ring-spin" style={{ borderTopColor: "rgba(255,255,255,0.25)" }} />
          </div>
        </div>
      )}

      {/* --- Active --- */}
      {phase === "active" && (
        <>
          {/* Full-frame avatar */}
          <video
            ref={avatarVideoRef}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover animate-fade-in"
          />

          {/* Hidden screen capture video */}
          <video ref={screenVideoRef} autoPlay playsInline muted className="hidden" />

          {/* Vignette */}
          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/50 via-transparent to-black/20" />

          {/* Controls pill */}
          <div
            className={`absolute bottom-6 left-1/2 -translate-x-1/2 transition-all duration-500 ${
              showControls ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
            }`}
          >
            <div className="flex items-center gap-1 px-2 py-2 rounded-full backdrop-blur-2xl" style={{ background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {/* Mute */}
              <button
                onClick={toggleMute}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${
                  isMuted ? "bg-red-500/60 hover:bg-red-500/70" : "hover:bg-white/10"
                }`}
              >
                {isMuted ? (
                  <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="1" y1="1" x2="23" y2="23" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18" />
                  </svg>
                ) : (
                  <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </button>

              {/* Screen share */}
              <button
                onClick={toggleScreenShare}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${
                  isSharing ? "bg-green-500/50 hover:bg-green-500/60" : "hover:bg-white/10"
                }`}
              >
                <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </button>

              {/* Chat */}
              <button
                onClick={() => setChatOpen((o) => !o)}
                className={`w-10 h-10 flex items-center justify-center rounded-full transition-all cursor-pointer ${
                  chatOpen ? "bg-white/15" : "hover:bg-white/10"
                }`}
              >
                <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </button>

              {/* Divider */}
              <div className="w-px h-5 bg-white/10 mx-1" />

              {/* End */}
              <button
                onClick={endSession}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-red-500/70 hover:bg-red-500/85 transition-all cursor-pointer"
              >
                <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 2.59 3.4z" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat panel */}
          <div
            className={`absolute bottom-[90px] left-1/2 -translate-x-1/2 w-[360px] max-h-[420px] flex flex-col rounded-2xl overflow-hidden backdrop-blur-2xl transition-all duration-300 ease-out ${
              chatOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-4 scale-95 pointer-events-none"
            }`}
            style={{ background: "rgba(10,10,10,0.92)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
              <span className="text-[11px] font-medium text-white/40 tracking-widest uppercase">Chat</span>
              <button onClick={() => setChatOpen(false)} className="text-white/25 hover:text-white/50 transition-colors cursor-pointer">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-[200px] scrollbar-hide">
              {messages.length === 0 && (
                <p className="text-white/15 text-xs text-center mt-14">Send a message to Ceres</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed animate-msg ${
                    msg.role === "user"
                      ? "bg-white/10 text-white/80 rounded-br-md"
                      : "bg-white/[0.04] text-white/55 rounded-bl-md"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <form
              className="px-3 pb-8 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                const text = chatInput.trim();
                if (!text) return;
                setChatInput("");
                handleUserMessage(text);
              }}
            >
              <div className="flex items-center gap-2 bg-white/[0.05] rounded-xl px-3 py-2 border border-white/[0.05] focus-within:border-white/15 transition-colors">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Message..."
                  className="flex-1 bg-transparent text-sm text-white placeholder-white/20 outline-none"
                />
                <button type="submit" className="w-7 h-7 flex items-center justify-center rounded-full bg-white/8 hover:bg-white/15 transition-colors cursor-pointer flex-shrink-0">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Hidden canvas */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
