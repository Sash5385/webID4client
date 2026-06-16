import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "../../firebase/auth";
import { updateUserProfile } from "../../firebase/db";
import { useTheme } from "../../hooks/useTheme";
import { getInitials, formatPhone } from "../../utils/format";
import "./ProfileTab.css";

const TSCS = [
  { id: "8041", name: "ТСЦ 8041", area: "вул. Перемоги 20" },
  { id: "8042", name: "ТСЦ 8042", area: "вул. Мрії 19" },
];

const EXPERIENCES = [
  { id: "no_license", name: "Не маю посвідчення, збираюсь складати іспит" },
  { id: "has_license", name: "Маю посвідчення, не маю досвіду водіння" },
];

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

export default function ProfileTab({ user, profile, onProfileUpdate }) {
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const startEdit = () => {
    setForm({
      name: profile.name || "",
      studentType: profile.studentType || "school",
      tscCenter: profile.tscCenter || "8041",
      experience: profile.experience || "no_license",
      filmingConsent: profile.filmingConsent ?? true,
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      alert("Введи імʼя");
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile(user.uid, {
        name: form.name.trim(),
        studentType: form.studentType,
        tscCenter: form.studentType === "school" ? form.tscCenter : null,
        experience: form.experience,
        filmingConsent: form.filmingConsent,
      });
      await onProfileUpdate?.();
      setEditing(false);
      setForm(null);
    } catch (e) {
      alert("Помилка: " + e.message);
    } finally {
      setSaving(false);
    }
  };

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
        <div className="section-head">
          <div className="section-title">Анкета</div>
          {!editing && (
            <button className="edit-btn" onClick={startEdit}>✏️ Редагувати</button>
          )}
        </div>

        {!editing ? (
          <>
            <div className="profile-row">
              <span className="key">Імʼя</span>
              <span className="val">{profile.name || "—"}</span>
            </div>
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
          </>
        ) : (
          <div className="profile-edit">
            <label className="edit-label">Імʼя та прізвище</label>
            <input
              className="edit-input"
              type="text"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />

            <label className="edit-label">Тип учня</label>
            <div className="edit-tiles">
              {["school", "private"].map(t => (
                <button
                  key={t}
                  className={`edit-tile${form.studentType === t ? " selected" : ""}`}
                  onClick={() => setForm(f => ({ ...f, studentType: t }))}
                >
                  {STUDENT_TYPE_LABELS[t]}
                </button>
              ))}
            </div>

            {form.studentType === "school" && (
              <>
                <label className="edit-label">ТСЦ</label>
                <div className="edit-list">
                  {TSCS.map(t => (
                    <button
                      key={t.id}
                      className={`edit-item${form.tscCenter === t.id ? " selected" : ""}`}
                      onClick={() => setForm(f => ({ ...f, tscCenter: t.id }))}
                    >
                      <span className="edit-item-title">{t.name}</span>
                      <span className="edit-item-sub">{t.area}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {form.studentType === "private" && (
              <>
                <label className="edit-label">Досвід</label>
                <div className="edit-list">
                  {EXPERIENCES.map(ex => (
                    <button
                      key={ex.id}
                      className={`edit-item${form.experience === ex.id ? " selected" : ""}`}
                      onClick={() => setForm(f => ({ ...f, experience: ex.id }))}
                    >
                      <span className="edit-item-title">{ex.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="edit-toggle-row">
              <span className="key">Зйомка відео/аудіо для реклами</span>
              <button
                className={`edit-switch${form.filmingConsent ? " on" : ""}`}
                onClick={() => setForm(f => ({ ...f, filmingConsent: !f.filmingConsent }))}
              >
                <span className="edit-switch-knob" />
              </button>
            </div>

            <div className="edit-actions">
              <button className="edit-cancel" onClick={cancelEdit} disabled={saving}>Скасувати</button>
              <button className="edit-save" onClick={handleSave} disabled={saving}>
                {saving ? "Збереження…" : "Зберегти"}
              </button>
            </div>
          </div>
        )}
      </div>


      <div className="profile-section">
        <div className="section-title">Контакти інструктора</div>
        <div className="contact-phone-block">
          <div className="contact-btns">
            <a href="tel:+380989225442" className="contact-btn contact-btn--call" aria-label="Зателефонувати">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1C10.61 21 3 13.39 3 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.24 1.01l-2.21 2.21z"/></svg>
            </a>
            <a href="https://t.me/+380989225442" target="_blank" rel="noopener noreferrer" className="contact-btn contact-btn--tg" aria-label="Telegram">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8l-1.7 8c-.12.57-.46.71-.93.44l-2.58-1.9-1.24 1.19c-.14.14-.25.25-.51.25l.18-2.62 4.72-4.26c.2-.18-.05-.28-.32-.1L7.6 14.47l-2.54-.79c-.55-.17-.56-.55.12-.82l9.93-3.83c.46-.17.86.11.53.77z"/></svg>
            </a>
            <a href="viber://chat?number=%2B380989225442" className="contact-btn contact-btn--viber" aria-label="Viber">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.4 1.5C7.5 1.7 4 4.4 3.2 8.2c-.4 2-.3 3.9.4 5.7.5 1.3 1.4 2.5 2.4 3.5l.3 3.3c.1.6.8.8 1.2.4l2.4-2.1c.6.1 1.2.2 1.8.2 4.3 0 7.9-3.2 8.3-7.4.5-4.8-3-9.6-8.6-10.3zm4.5 13.2c-.4.4-1 .7-1.6.8-.3.1-.7.1-1 0-.9-.2-1.7-.6-2.5-1.1-1.5-1-2.8-2.3-3.6-3.9-.4-.8-.7-1.6-.7-2.5 0-.6.2-1.2.6-1.6.3-.4.8-.6 1.3-.6.2 0 .4 0 .5.1.2.1.3.2.4.4l1.3 1.8c.1.2.2.4.2.6 0 .2-.1.4-.3.6l-.4.4c-.1.1-.2.2-.2.3s0 .2.1.3c.4.7 1 1.3 1.6 1.8.3.2.5.2.7 0l.4-.4c.2-.2.4-.3.6-.3.2 0 .4.1.6.2l1.8 1.2c.2.1.3.3.4.5.1.4-.1.8-.2 1.4z"/></svg>
            </a>
            <a href="https://wa.me/380989225442" target="_blank" rel="noopener noreferrer" className="contact-btn contact-btn--wa" aria-label="WhatsApp">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.47 14.38c-.28-.14-1.64-.81-1.9-.9-.25-.1-.44-.14-.62.14-.18.28-.72.9-.88 1.09-.16.19-.32.21-.6.07-.28-.14-1.18-.44-2.25-1.39-.83-.74-1.39-1.66-1.56-1.94-.16-.28-.02-.43.12-.57.13-.12.28-.32.42-.48.14-.16.18-.28.28-.46.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.05-.22-.54-.45-.47-.62-.47-.16 0-.35-.02-.53-.02s-.48.07-.73.34c-.25.28-.96.94-.96 2.3 0 1.35.98 2.66 1.12 2.84.14.18 1.93 2.94 4.67 4.13.65.28 1.16.45 1.56.57.65.21 1.25.18 1.72.11.52-.08 1.64-.67 1.87-1.32.23-.65.23-1.2.16-1.32-.07-.12-.25-.19-.53-.33z"/><path d="M12.04 2C6.48 2 2 6.48 2 12.04c0 1.85.5 3.58 1.37 5.06L2 22l5.08-1.33A10.02 10.02 0 0012.04 22C17.6 22 22 17.52 22 12.04 22 6.48 17.6 2 12.04 2zm0 18.16c-1.7 0-3.28-.46-4.64-1.26l-.33-.2-3.42.9.91-3.34-.22-.34a8.15 8.15 0 01-1.28-4.38c0-4.5 3.66-8.16 8.16-8.16 4.5 0 8.16 3.66 8.16 8.16 0 4.5-3.66 8.16-8.16 8.16z"/></svg>
            </a>
          </div>
        </div>
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
