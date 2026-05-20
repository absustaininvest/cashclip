import { Linkedin, Instagram, type LucideIcon } from "lucide-react";

export interface SocialLink {
  name: string;
  url: string;
  handle: string;
  Icon: LucideIcon;
}

export const SOCIALS: SocialLink[] = [
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/company/ab-sustainability-investments",
    handle: "AB Sustainability Investments",
    Icon: Linkedin,
  },
  {
    name: "Instagram",
    url: "https://www.instagram.com/absustaininvest",
    handle: "@absustaininvest",
    Icon: Instagram,
  },
];

export const CASHCLIP_SOCIALS: SocialLink[] = [];
