/* webrtc-manual.js
   Manual signaling WebRTC. No backend. Each "peer" UI box corresponds to a single RTCPeerConnection
*/
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const muteAudioBtn = document.getElementById("muteAudioBtn");
const toggleCamBtn = document.getElementById("toggleCamBtn");
const localVideo = document.getElementById("localVideo");
const createPeerBtn = document.getElementById("createPeerBtn");
const peerNameInput = document.getElementById("peerName");
const peerList = document.getElementById("peerList");
const remotes = document.getElementById("remotes");

let localStream = null;
let peers = {}; // key: peerId (user-chosen name + random) -> { pc, name, remoteEl, candidatesFromLocalCollector }
const ICE_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// utils
function makeId(name) {
  return `${name || "peer"}-${Math.random().toString(36).slice(2, 9)}`;
}
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  children.forEach((c) => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}

// Start local media
startBtn.onclick = async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localVideo.srcObject = localStream;
    muteAudioBtn.disabled = false;
    toggleCamBtn.disabled = false;
    stopBtn.disabled = false;
    startBtn.disabled = true;
  } catch (err) {
    alert("Could not get camera/microphone: " + err.message);
  }
};

// Mute/unmute audio
muteAudioBtn.onclick = () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  muteAudioBtn.textContent = track.enabled ? "Mute Audio" : "Unmute Audio";
};

// Toggle camera
toggleCamBtn.onclick = () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleCamBtn.textContent = track.enabled ? "Camera Off" : "Camera On";
};

// Stop all (close peerconnections & stop tracks)
stopBtn.onclick = () => {
  for (const id in peers) {
    try {
      peers[id].pc.close();
    } catch (e) {}
    removePeerUI(id);
  }
  peers = {};
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
    localVideo.srcObject = null;
  }
  startBtn.disabled = false;
  muteAudioBtn.disabled = true;
  toggleCamBtn.disabled = true;
  stopBtn.disabled = true;
};

// Create a PeerConnection box (one for each remote person)
createPeerBtn.onclick = () => {
  const name = peerNameInput.value.trim() || "peer";
  const id = makeId(name);
  addPeerUI(id, name);
  peerNameInput.value = "";
};

// Add UI for a peer
function addPeerUI(id, name) {
  const box = el("div", { className: "peer-item", id: "peer-" + id });

  const title = el(
    "div",
    {},
    el("strong", {}, name),
    el("span", { className: "small", style: "margin-left:8px" }, ` (${id})`)
  );
  const status = el(
    "div",
    { className: "small", style: "margin-top:6px" },
    "Status: idle"
  );

  // controls
  const btnCreateOffer = el("button", {}, "Create Offer");
  const btnCopyLocal = el("button", {}, "Copy Local SDP");
  const btnHandleRemoteOffer = el(
    "button",
    {},
    "Handle Remote Offer (Create Answer)"
  );
  const btnHandleRemoteAnswer = el("button", {}, "Handle Remote Answer");
  const btnCopyIce = el("button", {}, "Copy Latest Local ICE");
  const btnAddRemoteIce = el("button", {}, "Add Remote ICE");

  // textareas
  const localSDP = el("textarea", {
    placeholder: "Local SDP (offer/answer) will appear here",
  });
  const remoteSDP = el("textarea", {
    placeholder: "Paste remote SDP (offer or answer) here",
  });
  const iceBox = el("textarea", {
    placeholder: "ICE candidates log; copy/paste candidate JSON lines here",
  });

  // remote video container for this peer
  const remoteVideo = el("video", {
    autoplay: true,
    playsInline: true,
    id: "remote-video-" + id,
  });
  const remoteContainer = el("div", {}, remoteVideo);

  // assemble
  box.appendChild(title);
  box.appendChild(status);
  box.appendChild(
    el(
      "div",
      { style: "margin-top:8px" },
      btnCreateOffer,
      btnHandleRemoteOffer,
      btnHandleRemoteAnswer
    )
  );
  box.appendChild(
    el(
      "div",
      { style: "margin-top:6px" },
      btnCopyLocal,
      btnCopyIce,
      btnAddRemoteIce
    )
  );
  box.appendChild(
    el(
      "div",
      { style: "margin-top:8px" },
      el("label", {}, "Local SDP:"),
      localSDP
    )
  );
  box.appendChild(
    el(
      "div",
      { style: "margin-top:8px" },
      el("label", {}, "Remote SDP:"),
      remoteSDP
    )
  );
  box.appendChild(
    el(
      "div",
      { style: "margin-top:8px" },
      el("label", {}, "ICE Candidates (copied lines):"),
      iceBox
    )
  );
  box.appendChild(remoteContainer);

  peerList.appendChild(box);
  remotes.appendChild(remoteVideo);

  // create peer object
  peers[id] = {
    id,
    name,
    pc: null,
    statusEl: status,
    localSDPEl: localSDP,
    remoteSDPEl: remoteSDP,
    iceEl: iceBox,
    lastLocalCandidate: null,
    remoteVideoEl: remoteVideo,
  };

  // button handlers
  btnCreateOffer.onclick = async () => createOfferForPeer(id);
  btnCopyLocal.onclick = () => copyToClipboard(peers[id].localSDPEl.value);
  btnHandleRemoteOffer.onclick = async () =>
    handleRemoteOfferAndCreateAnswer(id);
  btnHandleRemoteAnswer.onclick = async () => handleRemoteAnswer(id);
  btnCopyIce.onclick = () =>
    copyToClipboard(peers[id].lastLocalCandidate || "");
  btnAddRemoteIce.onclick = async () => {
    const text = peers[id].iceEl.value.trim();
    if (!text) {
      alert("Paste candidate lines into the ICE candidates box first");
      return;
    }
    // accept multiple JSON lines separated by newline
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const ln of lines) {
      try {
        const cand = JSON.parse(ln);
        if (peers[id] && peers[id].pc) {
          await peers[id].pc.addIceCandidate(cand);
          peers[id].statusEl.textContent = "Status: added remote ICE";
        }
      } catch (e) {
        console.warn("invalid candidate JSON", ln);
      }
    }
  };
}

// remove UI and remote video
function removePeerUI(id) {
  const elBox = document.getElementById("peer-" + id);
  if (elBox) elBox.remove();
  const rv = document.getElementById("remote-video-" + id);
  if (rv) rv.remove();
}

// create RTCPeerConnection and attach local stream + handlers
function ensurePC(id) {
  if (!peers[id]) throw new Error("Unknown peer " + id);
  if (peers[id].pc) return peers[id].pc;

  const pc = new RTCPeerConnection(ICE_CONFIG);
  peers[id].pc = pc;

  // add local tracks
  if (localStream)
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  // remote tracks -> remote video element
  pc.ontrack = (ev) => {
    console.log("ontrack", id, ev.streams);
    const rv = peers[id].remoteVideoEl;
    if (!rv.srcObject) rv.srcObject = ev.streams[0];
  };

  // collect local ICE candidates (we show last candidate; you can copy many)
  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      const raw = JSON.stringify(ev.candidate);
      // append to ICE textarea
      const cur = peers[id].iceEl.value.trim();
      peers[id].iceEl.value = (cur ? cur + "\n" : "") + raw;
      peers[id].lastLocalCandidate = raw;
      peers[id].statusEl.textContent = "Status: local ICE candidate gathered";
    } else {
      // null candidate indicates end of candidates in some browsers
      peers[id].statusEl.textContent = "Status: ICE gathering finished";
    }
  };

  pc.onconnectionstatechange = () => {
    peers[id].statusEl.textContent = "Status: " + pc.connectionState;
  };

  return pc;
}

// Create offer (initiator)
async function createOfferForPeer(id) {
  try {
    const pc = ensurePC(id);
    peers[id].statusEl.textContent = "Status: creating offer...";
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // local SDP
    peers[id].localSDPEl.value = JSON.stringify(pc.localDescription);
    peers[id].statusEl.textContent =
      "Status: offer created - share this JSON with remote";
  } catch (e) {
    console.error(e);
    alert("Offer error: " + e.message);
  }
}

// Handle remote offer, create answer (the other side)
async function handleRemoteOfferAndCreateAnswer(id) {
  try {
    const pc = ensurePC(id);
    const txt = peers[id].remoteSDPEl.value.trim();
    if (!txt)
      return alert(
        "Paste remote offer SDP (JSON) into the Remote SDP box then click this button."
      );
    const remoteDesc = JSON.parse(txt);
    await pc.setRemoteDescription(remoteDesc);
    peers[id].statusEl.textContent =
      "Status: remote offer set - creating answer...";
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    peers[id].localSDPEl.value = JSON.stringify(pc.localDescription);
    peers[id].statusEl.textContent =
      "Status: answer created - send Local SDP (answer) back to initiator";
  } catch (e) {
    console.error(e);
    alert("Error handling remote offer: " + e.message);
  }
}

// Handle remote answer (initiator pastes answer)
async function handleRemoteAnswer(id) {
  try {
    const pc = ensurePC(id);
    const txt = peers[id].remoteSDPEl.value.trim();
    if (!txt)
      return alert("Paste remote answer SDP (JSON) into the Remote SDP box.");
    const remoteDesc = JSON.parse(txt);
    await pc.setRemoteDescription(remoteDesc);
    peers[id].statusEl.textContent = "Status: remote answer set - awaiting ICE";
  } catch (e) {
    console.error(e);
    alert("Error handling remote answer: " + e.message);
  }
}

// handy clipboard copy
function copyToClipboard(text) {
  if (!text) return alert("Nothing to copy");
  navigator.clipboard.writeText(text).then(
    () => alert("Copied to clipboard"),
    (err) => alert("Copy failed: " + err)
  );
}
