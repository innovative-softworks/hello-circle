import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { colors, fonts } from "../theme";

const DISMISSED_KEY = "hello_circle_cookie_notice_dismissed";

// Everything this app stores is strictly necessary (session cookie, guest
// booking ID, favourites — see CookiePolicy.tsx) — there's no optional
// tracking/analytics to consent to, so this is a one-button acknowledgement,
// not an Accept/Reject choice with nothing real behind the "Reject" option.
export function CookieNotice() {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISSED_KEY) === "1");
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      className="pop-in"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 50,
        maxWidth: 640,
        margin: "0 auto",
        background: colors.dark,
        color: "#fff",
        borderRadius: 16,
        padding: "16px 18px",
        boxShadow: "0 18px 40px rgba(0,0,0,.25)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 14,
      }}
    >
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, flex: "1 1 320px" }}>
        We only use cookies/local storage that are strictly necessary to run this site — no analytics, no tracking.{" "}
        <span
          onClick={() => navigate("/cookies")}
          style={{ textDecoration: "underline", cursor: "pointer", fontWeight: 600, color: "#fff" }}
        >
          Learn more
        </span>
      </p>
      <button
        onClick={dismiss}
        className="btn"
        style={{
          background: "#fff",
          color: colors.dark,
          border: "none",
          borderRadius: 10,
          padding: "9px 18px",
          fontSize: 13.5,
          fontWeight: 700,
          fontFamily: fonts.body,
          cursor: "pointer",
          flex: "none",
        }}
      >
        OK
      </button>
    </div>
  );
}
