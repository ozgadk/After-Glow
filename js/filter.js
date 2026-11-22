// Light client-side filter. It can be bypassed by a determined user, so the
// real safety net is the Report button + admin panel (and optional approval mode).
const BAD = [
  // en
  "fuck", "shit", "bitch", "cunt", "whore", "slut", "nigger", "faggot", "retard",
  // lv
  "pimpis", "pizda", "maucis", "dirsa", "kuce",
  // ru (cyrillic + translit)
  "хуй", "пизд", "ебат", "ебан", "бляд", "сука", "мудак", "пидор", "blyat", "pidor",
  // tr
  "orospu", "siktir", "sikerim", "yarrak", "amına", "amina koy"
];

const norm = (s) => s.toLowerCase()
  .replace(/[@4]/g, "a").replace(/3/g, "e").replace(/[1!]/g, "i")
  .replace(/0/g, "o").replace(/\$/g, "s").replace(/[\s._*-]+/g, "");

export function checkText(text) {
  const n = norm(text);
  if (BAD.some((w) => n.includes(norm(w)))) return "blocked";
  // phone numbers (7+ digits, allowing spaces/dashes) and links
  if (/(\+?\d[\d\s\-()]{6,}\d)/.test(text)) return "noContacts";
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|lv|net|org|ru|io|me|tr)\b|@[a-z0-9_.]{3,})/i.test(text)) return "noContacts";
  return null;
}
