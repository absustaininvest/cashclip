import type { User } from "@workspace/db";

const DEMOGRAPHIC_TRUSTED_HOSTS: Record<string, string[]> = {
  cint:     ["cint.com", "survey.cint.com"],
  lucid:    ["samplicio.us", "luc.id"],
  cpx:      ["cpx-research.com", "offers.cpx-research.com"],
  bitlabs:  ["bitlabs.ai"],
  pollfish: ["pollfish.com", "wss.pollfish.com"],
};

function isTrustedDemographicHost(hostname: string, provider: string): boolean {
  const allowed = DEMOGRAPHIC_TRUSTED_HOSTS[provider];
  if (!allowed) return false;
  const h = hostname.toLowerCase();
  return allowed.some((domain) => h === domain || h.endsWith(`.${domain}`));
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age > 0 && age < 120 ? age : null;
}

function cintGender(gender: string | null | undefined): string | null {
  if (gender === "male") return "1";
  if (gender === "female") return "2";
  if (gender === "non_binary") return "3";
  return null;
}

export function buildDemographicEntryUrl(
  baseUrl: string,
  provider: string,
  userId: string,
  profile: Partial<Pick<User, "dateOfBirth" | "gender" | "zipCode" | "country" | "employmentStatus" | "householdIncome" | "educationLevel" | "ethnicity">>,
): string {
  if (!baseUrl) return baseUrl;

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return baseUrl;
  }

  if (url.protocol !== "https:") return baseUrl;
  if (!isTrustedDemographicHost(url.hostname, provider)) return baseUrl;

  const age = ageFromDob(profile.dateOfBirth);
  const country = profile.country || "US";

  if (provider === "cint") {
    url.searchParams.set("pid", userId);
    if (age !== null) url.searchParams.set("age", String(age));
    const g = cintGender(profile.gender);
    if (g) url.searchParams.set("gender", g);
    if (profile.zipCode) url.searchParams.set("zip", profile.zipCode);
    url.searchParams.set("country", country);
  } else if (provider === "lucid") {
    url.searchParams.set("RID", userId);
    if (age !== null) url.searchParams.set("age", String(age));
    if (profile.gender) url.searchParams.set("gender", profile.gender === "male" ? "1" : "2");
    if (profile.zipCode) url.searchParams.set("postal_code", profile.zipCode);
  } else if (provider === "cpx") {
    url.searchParams.set("ext_user_id", userId);
    if (age !== null) url.searchParams.set("subid1", String(age));
    if (profile.gender) url.searchParams.set("subid2", profile.gender);
  } else if (provider === "bitlabs") {
    url.searchParams.set("uid", userId);
    if (age !== null) url.searchParams.set("age", String(age));
    if (profile.gender) url.searchParams.set("gender", profile.gender);
  } else if (provider === "pollfish") {
    url.searchParams.set("user_id", userId);
    if (age !== null) url.searchParams.set("age", String(age));
    if (profile.gender) url.searchParams.set("gender", profile.gender);
  }

  return url.toString();
}
