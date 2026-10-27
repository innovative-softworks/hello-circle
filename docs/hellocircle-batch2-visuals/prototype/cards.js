// Prototype-only card renderer (mirrors the proposed shared ListingCard anatomy).
window.U = (id, w) => `https://images.unsplash.com/photo-${id}?w=${w || 700}&q=70&auto=format&fit=crop`;
window.card = function (d, opts) {
  const o = opts || {};
  const media = d.photo
    ? `<img src="${U(d.photo, 700)}" alt="${d.alt || d.title}" loading="lazy">`
    : `<div class="nophoto ${d.tone || "sport"}"><span class="np-kind">${d.kind}</span><span class="np-title">${d.title}</span><span class="np-date">${d.dateShort || ""}</span></div>`;
  const pills = (d.pills || []).map(([t, c]) => `<span class="pill ${c}">${t}</span>`).join("");
  const lines = (d.lines || []).map(([i, t]) => `<div class="line">${ic(i)}<span>${t}</span></div>`).join("");
  return `<article class="card ${o.row ? "row" : ""}">
    <div class="media">${media}<div class="tl">${d.photo ? pills : ""}</div><span class="save" aria-label="Save">${ic("heart")}</span></div>
    <div class="meta"><span class="kind">${d.kind}${d.org ? ` · ${d.org}` : ""}</span><h3>${d.title}</h3>${lines}
      <div class="foot"><span class="price">${d.price}${d.per ? ` <small>${d.per}</small>` : ""}</span>${d.avail ? `<span class="pill ${d.availTone || "green"}">${d.avail}</span>` : ""}</div></div>
  </article>`;
};
window.RESULTS = [
  { kind: "Adventure", title: "Wicklow Way Guided Hike", photo: "1551632811-561732d1e306", lines: [["cal", "Sat 24 Oct · 09:00 · 6h"], ["pin", "Roundwood, Wicklow"]], price: "€35", per: "per person", avail: "10 places left", org: "Wild Atlantic Adventures", pills: [["Moderate", "white"]] },
  { kind: "Activity", title: "Hiking Group Walk", tone: "outdoor", dateShort: "Sat 24 Oct · 13:00", lines: [["cal", "Sat 24 Oct · 13:00 · 2h"], ["pin", "Dooradoyle, Limerick"]], price: "Free", avail: "6 of 12 going", availTone: "grey", org: "Hosted by Aoife B." },
  { kind: "Circle", title: "Sunday Pier Walkers", photo: "1511632765486-a01980e01a18", lines: [["users", "14 members · meets weekly"], ["pin", "Dún Laoghaire, Dublin"]], price: "Free to join", avail: "Next: Sun 25 Oct", availTone: "blue" },
  { kind: "Programme · 6 weeks", title: "Couch to 5k Walk–Run", photo: "1552674605-db6ffd4facb5", lines: [["cal", "Starts Tue 3 Nov · Tuesdays 19:00"], ["pin", "Phoenix Park, Dublin"]], price: "€60", per: "whole programme", avail: "4 places left", availTone: "amber" },
  { kind: "Experience", title: "Coastal Cliff Walk & Tea", photo: "1637548076898-f896229b2f3b", lines: [["cal", "Sun 25 Oct · 11:00 · 3h"], ["pin", "Howth, Dublin"]], price: "€25", per: "per person", avail: "Few places left", availTone: "amber" },
  { kind: "Activity", title: "Evening Dog Walk Meetup", tone: "social", dateShort: "Thu 22 Oct · 18:30", lines: [["cal", "Thu 22 Oct · 18:30 · 1h"], ["pin", "Marlay Park, Dublin"]], price: "Free", avail: "Needs 2 more", availTone: "amber", org: "Hosted by Ciarán D." },
  { kind: "Adventure", title: "Glendalough Lakes Loop", photo: "1470071459604-3b5ec3a7fe05", lines: [["cal", "Sat 31 Oct · 10:00 · 4h"], ["pin", "Glendalough, Wicklow"]], price: "€30", per: "per person", avail: "12 places left" },
  { kind: "Circle", title: "Cork Saturday Parkrun Circle", tone: "circle", dateShort: "Every Saturday", lines: [["users", "7 members · meets weekly"], ["pin", "Cork City"]], price: "Free to join", avail: "Nothing planned yet", availTone: "grey" },
];
