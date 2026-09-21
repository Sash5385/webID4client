import { useState, useEffect } from "react";
import { ref, onValue } from "firebase/database";
import { db } from "../firebase/config";

// undefined = ще завантажується, null = вузла license нема в базі (доступ
// дозволено як і раніше — фіча вимкнена, поки для інстансу не заведено ліцензію)
export function useLicense() {
  const [license, setLicense] = useState(undefined);
  useEffect(() => {
    return onValue(ref(db, "license"), snap => setLicense(snap.val()), () => setLicense(null));
  }, []);
  return license;
}

export function isLicenseBlocked(license) {
  if (!license) return false;
  if (license.status === "suspended") return true;
  const now = Date.now();
  if (license.status === "trial" && license.trialEndsAt && now > license.trialEndsAt) return true;
  if (license.status === "active" && license.expiresAt && now > license.expiresAt) return true;
  return false;
}
