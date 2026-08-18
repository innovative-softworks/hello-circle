import { useNavigate } from "react-router-dom";
import { colors, maxWidth } from "../theme";

export function Footer() {
  const navigate = useNavigate();

  return (
    <footer style={{ borderTop: `1px solid ${colors.border}`, background: colors.footerBg }}>
      <div
        style={{
          maxWidth,
          margin: "0 auto",
          padding: "34px 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }} onClick={() => navigate("/")}>
          <img src="/illustrations/Logo.svg" alt="Hello Circle" style={{ height: 38 }} />
        </div>
        <p style={{ margin: 0, color: "#8A928B", fontSize: 14, maxWidth: 420 }}>
          Local community spaces & sports clubs across Ireland. A concept prototype — not affiliated with any council
          or governing body.
        </p>
        <div style={{ marginLeft: "auto", display: "flex", gap: 20, color: colors.muted, fontSize: 14, fontWeight: 600 }}>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/browse/centres")}>
            Councils
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/browse/clubs")}>
            Clubs
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/privacy")}>
            Privacy
          </span>
          <span className="link-accent" style={{ cursor: "pointer" }} onClick={() => navigate("/cookies")}>
            Cookies
          </span>
        </div>
      </div>
    </footer>
  );
}
