import { useNavigate } from "react-router-dom";
import { signOut } from "../../firebase/auth";
import { useTheme } from "../../hooks/useTheme";
import { getInitials, formatPhone } from "../../utils/format";
import "./ProfileTab.css";

const TSC_LABELS = {
  "8041": "ТСЦ 8041 — вул. Перемоги 20",
  "8042": "ТСЦ 8042 — вул. Мрії 19",
};

const STUDENT_TYPE_LABELS = {
  school: "Автошкола",
  private: "Приватний урок",
};

const EXPERIENCE_LABELS = {
  no_license: "Не маю посвідчення, збираюсь складати іспит",
  has_license: "Маю посвідчення, не маю досвіду водіння",
  novice: "Початківець",
  basic: "Базовий",
  licensed: "З правами",
};

export default function ProfileTab({ user, profile }) {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    if (!confirm("Вийти з акаунту?")) return;
    await signOut();
    navigate("/", { replace: true });
  };

  if (!profile) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--dim)" }}>
        Завантаження профілю...
      </div>
    );
  }

  return (
    <div className="profile-tab">
      <div className="profile-banner">
        <div className="profile-avatar">{getInitials(profile.name)}</div>
        <div className="profile-name">{profile.name}</div>
        <div className="profile-phone">{formatPhone(profile.phone || user?.phoneNumber)}</div>
      </div>

      <div className="profile-section">
        <div className="section-title">Анкета</div>
        <div className="profile-row">
          <span className="key">Тип учня</span>
          <span className="val">{STUDENT_TYPE_LABELS[profile.studentType] || "—"}</span>
        </div>
        {profile.studentType === "school" && (
          <div className="profile-row">
            <span className="key">ТСЦ</span>
            <span className="val">{TSC_LABELS[profile.tscCenter] || profile.tscCenter || "—"}</span>
          </div>
        )}
        {profile.studentType === "private" && (
          <div className="profile-row">
            <span className="key">Досвід</span>
            <span className="val">{EXPERIENCE_LABELS[profile.experience] || profile.experience || "—"}</span>
          </div>
        )}
        <div className="profile-row">
          <span className="key">Зйомка відео/аудіо для реклами</span>
          <span className="val">{profile.filmingConsent ? "Так" : "Ні"}</span>
        </div>
      </div>

      <div className="profile-section">
        <div className="section-title">Тема</div>
        <div className="theme-toggle">
          <button className={`theme-btn ${theme === "dark" ? "active" : ""}`} onClick={() => setTheme("dark")}>
            🌙 Темна
          </button>
          <button className={`theme-btn ${theme === "light" ? "active" : ""}`} onClick={() => setTheme("light")}>
            ☀️ Світла
          </button>
        </div>
      </div>

      <div className="profile-section">
        <div className="section-title">Контакти інструктора</div>
        <a href="tel:+380989225442" className="contact-link">
          <div className="ico">📞</div>
          <div className="info">
            <div className="lbl">Телефон</div>
            <div className="val">+380 98 922 54 42</div>
          </div>
        </a>
        <a
          href="https://maps.google.com/?q=Київ,+вул.+Верховинна,+44"
          target="_blank"
          rel="noopener noreferrer"
          className="contact-link"
        >
          <div className="ico">📍</div>
          <div className="info">
            <div className="lbl">Адреса</div>
            <div className="val">Київ, Верховинна 44</div>
          </div>
        </a>
      </div>

      <button className="logout-btn" onClick={handleLogout}>
        Вийти з акаунту
      </button>
    </div>
  );
}
