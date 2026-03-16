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
    ".chippy-bubble{position:fixed;bottom:24px;z-index:2147483646;width:60px;height:60px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 20px rgba(0,0,0,0.18),0 1px 4px rgba(0,0,0,0.1);transition:transform .2s cubic-bezier(.22,1,.36,1),box-shadow .2s ease;}",
    ".chippy-bubble:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,0,0,0.22),0 2px 6px rgba(0,0,0,0.12);}",
    ".chippy-bubble:active{transform:scale(0.95);}",
    ".chippy-bubble svg{transition:transform .3s cubic-bezier(.22,1,.36,1);}",
    ".chippy-bubble[data-open='true'] svg{transform:rotate(90deg);}",
    ".chippy-panel{position:fixed;bottom:100px;z-index:2147483647;width:400px;height:min(680px,calc(100vh - 140px));border-radius:20px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,0.15),0 4px 16px rgba(0,0,0,0.08);border:1px solid rgba(0,0,0,0.06);opacity:0;transform:translateY(16px) scale(0.96);pointer-events:none;transition:opacity .3s cubic-bezier(.22,1,.36,1),transform .3s cubic-bezier(.22,1,.36,1);}",
    ".chippy-panel[data-open='true']{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}",
    ".chippy-panel iframe{width:100%;height:100%;border:none;border-radius:20px;}",
    ".chippy-backdrop{position:fixed;inset:0;z-index:2147483645;background:transparent;display:none;}",
    ".chippy-backdrop[data-open='true']{display:block;}",
    "@media(max-width:480px){",
    "  .chippy-panel{width:calc(100vw - 24px);height:calc(100vh - 140px);bottom:96px;left:12px!important;right:12px!important;border-radius:16px;}",
    "  .chippy-bubble{bottom:20px;width:54px;height:54px;}",
    "}",
  ].join("\n");
  document.head.appendChild(style);

  // Backdrop (close on click outside)
  backdrop = document.createElement("div");
  backdrop.className = "chippy-backdrop";
  backdrop.addEventListener("click", toggle);

  // Bubble button
  bubble = document.createElement("button");
  bubble.className = "chippy-bubble";
  bubble.style.background = COLOR;
  bubble.style[POSITION === "left" ? "left" : "right"] = "24px";
  bubble.setAttribute("aria-label", "Open support chat");
  bubble.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    "</svg>";
  bubble.addEventListener("click", toggle);

  // Panel
  panel = document.createElement("div");
  panel.className = "chippy-panel";
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
      iframe.allow = "microphone; camera; display-capture";
      panel.appendChild(iframe);
    }
  }

  // Mount
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(bubble);
})();
