// HelloCircle Batch 2 — isolated static prototype chrome. NOT production code.
(function () {
  const I = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pin: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    heart: '<path d="M20.8 6.6a5 5 0 0 0-8.1-1.4L12 6l-.7-.8a5 5 0 1 0-7.1 7.1L12 20l7.8-7.7a5 5 0 0 0 1-5.7z"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5"/>',
    more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m8.5 12 2.5 2.5 4.5-4.5"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    map: '<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h0M3.5 12h0M3.5 18h0"/>',
    chev: '<path d="m9 6 6 6-6 6"/>', back: '<path d="m15 6-6 6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    flag: '<path d="M5 21V4h11l-1.5 4L16 12H5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
    ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    dir: '<path d="m3 11 18-8-8 18-2-8z"/>', plus: '<path d="M12 5v14M5 12h14"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    poll: '<path d="M5 20V10M12 20V4M19 20v-7"/>', idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
  };
  window.ic = (n, cls) => `<svg class="ic ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${I[n] || ""}</svg>`;
  document.querySelectorAll("[data-ic]").forEach((el) => { el.insertAdjacentHTML("afterbegin", window.ic(el.dataset.ic)); });
  const page = document.body.dataset.page || "";
  const signedIn = document.body.dataset.signedin === "1";
  const on = (k) => (page === k ? "on" : "");
  const hdr = `<header class="hdr"><div class="wrap">
    <a class="logo" href="#"><i></i>HelloCircle</a>
    <nav class="nav"><a class="${on("explore")}" href="#">Explore ▾</a><a class="${on("circles")}" href="#">Circles</a>${signedIn ? `<a class="${on("mylife")}" href="#">My Life</a>` : ""}<a class="start" href="#">＋ Start ▾</a></nav>
    <div class="sp"></div>
    ${document.body.dataset.hdrsearch === "1" ? `<div class="desk" style="flex:0 1 360px"><div class="search" style="min-height:42px;grid-template-columns:1fr"><div class="q support">${window.ic("search")} Search activities, Circles or places…</div></div></div>` : ""}
    <div class="hdr-icons">${signedIn ? `<span class="desk">${window.ic("heart")}</span><span class="desk">${window.ic("bell")}</span><span class="desk">${window.ic("chat")}</span><span class="avatar">CR</span>` : `<span class="mobile-only">${window.ic("search")}</span><a class="btn secondary sm desk" href="#">Log in</a><a class="btn sm desk" style="background:#172019;color:#fff" href="#">Sign up</a><span class="mobile-only">☰</span>`}</div>
  </div></header>`;
  document.body.insertAdjacentHTML("afterbegin", hdr);
  const tabs = ["Home", "Explore", "Start", "Circles", "My Life"];
  const keys = ["home", "explore", "start", "circles", "mylife"];
  document.body.insertAdjacentHTML("beforeend", `<nav class="tabbar">${tabs.map((t, i) => `<span class="${keys[i] === page ? "on" : ""} ${t === "Start" ? "plus" : ""}"><b></b>${t}</span>`).join("")}</nav><div class="proto-tag">PROPOSED · PROTOTYPE</div>`);
})();
