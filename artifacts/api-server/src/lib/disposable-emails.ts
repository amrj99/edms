// Common disposable / temporary email domains.
// Kept deliberately short — catches the vast majority of abuse without
// false-positiving on legitimate providers.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamailblock.com",
  "grr.la", "guerrillamail.info", "guerrillamail.biz", "guerrillamail.de",
  "guerrillamail.net", "guerrillamail.org", "spam4.me", "trashmail.at",
  "trashmail.com", "trashmail.io", "trashmail.me", "trashmail.net",
  "trashmail.org", "yopmail.com", "yopmail.fr", "cool.fr.nf",
  "jetable.fr.nf", "nospam.ze.tc", "nomail.xl.cx", "mega.zik.dj",
  "speed.1s.fr", "courriel.fr.nf", "moncourrier.fr.nf", "monemail.fr.nf",
  "monmail.fr.nf", "throwam.com", "throwaway.email", "temp-mail.org",
  "tempmail.com", "tempmail.net", "tempr.email", "dispostable.com",
  "discard.email", "maildrop.cc", "sharklasers.com", "guerrillamail.info",
  "spam.la", "fakeinbox.com", "mailnull.com", "spamgourmet.com",
  "spamgourmet.net", "spamgourmet.org", "spamtrail.com", "spamtrap.ro",
  "crapmail.org", "spaml.de", "emailsensei.com", "emailtemporaire.com",
  "getairmail.com", "getnada.com", "inoutmail.de", "inoutmail.eu",
  "inoutmail.info", "inoutmail.net", "junk1.de", "kasmail.com",
  "lol.ovpn.to", "mailme.lv", "mailme.ir", "mailnew.com", "mailsac.com",
  "mintemail.com", "mt2014.com", "mt2015.com", "mt2016.com",
  "noblepioneer.com", "nowmymail.com", "throwam.com", "tlpn.org",
  "tmailinator.com", "zetmail.com", "0815.ru", "10minutemail.com",
  "10minutemail.net", "10minutemail.org", "20minutemail.com",
  "filzmail.com", "binkmail.com", "bobmail.info", "chammy.info",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}
