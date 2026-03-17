(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  var ROOM = SCRIPT && SCRIPT.getAttribute("data-room");
  if (!ROOM) return;

  var BASE =
    (SCRIPT && SCRIPT.getAttribute("data-base")) ||
    SCRIPT.src.replace(/\/embed\.js(\?.*)?$/, "");

  var POSITION = SCRIPT.getAttribute("data-position") || "right";
  var COLOR = SCRIPT.getAttribute("data-color") || "#18181B";

  var ROOM_URL = BASE + "?room=" + encodeURIComponent(ROOM);

  // State
  var open = false;
  var bubble, panel, iframe, backdrop;

  // Inject styles
  var style = document.createElement("style");
  style.textContent = [
    ".n22-bubble{position:fixed;bottom:24px;z-index:2147483646;width:56px;height:56px;border-radius:14px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.2),0 0 0 1px rgba(255,255,255,0.06);transition:transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s ease;}",
    ".n22-bubble:hover{transform:scale(1.05);box-shadow:0 4px 20px rgba(0,0,0,0.28),0 0 0 1px rgba(255,255,255,0.08);}",
    ".n22-bubble:active{transform:scale(0.96);}",
    ".n22-bubble .n22-icon{display:flex;align-items:center;gap:3px;height:20px;}",
    ".n22-bubble .n22-bar{width:3px;border-radius:2px;background:white;transition:height .3s cubic-bezier(.22,1,.36,1),opacity .3s ease;}",
    ".n22-bubble .n22-bar:nth-child(1){animation:n22-breathe 2s ease-in-out infinite;}",
    ".n22-bubble .n22-bar:nth-child(2){animation:n22-breathe 2s ease-in-out 0.3s infinite;}",
    ".n22-bubble .n22-bar:nth-child(3){animation:n22-breathe 2s ease-in-out 0.6s infinite;}",
    ".n22-bubble .n22-bar:nth-child(4){animation:n22-breathe 2s ease-in-out 0.15s infinite;}",
    ".n22-bubble .n22-bar:nth-child(5){animation:n22-breathe 2s ease-in-out 0.45s infinite;}",
    "@keyframes n22-breathe{0%,100%{height:8px;opacity:0.55;}50%{height:20px;opacity:1;}}",
    ".n22-bubble .n22-close{position:absolute;transition:opacity .25s ease,transform .25s cubic-bezier(.22,1,.36,1);opacity:0;transform:rotate(-90deg) scale(0.5);}",
    ".n22-bubble[data-open='true'] .n22-icon .n22-bar{animation:none!important;height:0px!important;opacity:0!important;}",
    ".n22-bubble[data-open='true'] .n22-close{opacity:1;transform:rotate(0) scale(1);}",
    ".n22-panel{position:fixed;bottom:96px;z-index:2147483647;width:380px;height:min(640px,calc(100vh - 130px));border-radius:6px;overflow:hidden;box-shadow:0 16px 64px rgba(0,0,0,0.25),0 2px 8px rgba(0,0,0,0.12),0 0 0 1px rgba(255,255,255,0.04);opacity:0;transform:translateY(12px) scale(0.98);pointer-events:none;transition:opacity .25s cubic-bezier(.22,1,.36,1),transform .25s cubic-bezier(.22,1,.36,1);}",
    ".n22-panel[data-open='true']{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}",
    ".n22-panel iframe{width:100%;height:100%;border:none;border-radius:6px;}",
    ".n22-backdrop{position:fixed;inset:0;z-index:2147483645;background:transparent;display:none;}",
    ".n22-backdrop[data-open='true']{display:block;}",
    "@media(max-width:480px){",
    "  .n22-panel{width:calc(100vw - 16px);height:calc(100vh - 120px);bottom:88px;left:8px!important;right:8px!important;border-radius:6px;}",
    "  .n22-bubble{bottom:20px;width:50px;height:50px;border-radius:12px;}",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // Backdrop (close on click outside)
  backdrop = document.createElement("div");
  backdrop.className = "n22-backdrop";
  backdrop.addEventListener("click", toggle);

  // Bubble button
  bubble = document.createElement("button");
  bubble.className = "n22-bubble";
  bubble.style.background = COLOR;
  bubble.style[POSITION === "left" ? "left" : "right"] = "24px";
  bubble.setAttribute("aria-label", "Open support chat");
  bubble.innerHTML =
    '<div class="n22-icon">' +
    '<div class="n22-bar"></div>' +
    '<div class="n22-bar"></div>' +
    '<div class="n22-bar"></div>' +
    '<div class="n22-bar"></div>' +
    '<div class="n22-bar"></div>' +
    '</div>' +
    '<svg class="n22-close" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="6 9 12 15 18 9"/>' +
    '</svg>';
  bubble.addEventListener("click", toggle);

  // Panel
  panel = document.createElement("div");
  panel.className = "n22-panel";
  panel.style[POSITION === "left" ? "left" : "right"] = "24px";

  // Lazy-load iframe on first open
  iframe = null;

  function toggle() {
    open = !open;
    bubble.setAttribute("data-open", open);
    panel.setAttribute("data-open", open);
    backdrop.setAttribute("data-open", open);

    if (open && !iframe) {
      iframe = document.createElement("iframe");
      iframe.src = ROOM_URL;
      iframe.allow = "microphone; camera; display-capture; autoplay";
      panel.appendChild(iframe);
    }
  }

  function closePanel() {
    if (!open) return;
    open = false;
    // Brief pulse on bubble before closing
    bubble.style.transform = "scale(0.9)";
    setTimeout(function () { bubble.style.transform = ""; }, 150);
    // Animate panel out
    panel.style.transition = "opacity .35s cubic-bezier(.22,1,.36,1), transform .35s cubic-bezier(.22,1,.36,1)";
    panel.setAttribute("data-open", "false");
    bubble.setAttribute("data-open", "false");
    backdrop.setAttribute("data-open", "false");
    // Destroy iframe so next open starts fresh
    setTimeout(function () {
      if (iframe && iframe.parentNode) { iframe.parentNode.removeChild(iframe); iframe = null; }
      panel.style.transition = "";
    }, 400);
  }

  // Listen for end-session message from iframe
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "n22-session-end") {
      closePanel();
    }
  });

  // Mount
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(bubble);
})();
