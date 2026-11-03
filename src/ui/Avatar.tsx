import { useState } from "react";

export function Avatar({ name, src, size = 28, color }: { name: string; src?: string | null; size?: number; color?: string }) {
  const [broken, setBroken] = useState(false);
  const initials = name.trim().slice(0, 1).toUpperCase() || "?";
  const style = { width: size, height: size, fontSize: size * 0.45, background: color ?? "#6965db" };
  if (src && !broken) {
    return <img className="avatar" src={src} alt={name} style={{ ...style, borderColor: color }} onError={() => setBroken(true)} referrerPolicy="no-referrer" />;
  }
  return <span className="avatar avatar-text" style={style} title={name}>{initials}</span>;
}
