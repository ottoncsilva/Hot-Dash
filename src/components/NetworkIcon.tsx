import {
  IconDot,
  IconFacebook,
  IconInstagram,
  IconMail,
  IconOnlyfans,
  IconPrivacy,
  IconTelegram,
  IconThreads,
  IconTiktok,
  IconWhatsapp,
  IconX,
  IconYoutube,
} from "@/components/icons";
import type { SocialNetwork } from "@/lib/types";

type IconComponent = (p: { size?: number }) => React.JSX.Element;

const NETWORK_ICON_MAP: Record<SocialNetwork, IconComponent> = {
  instagram: IconInstagram,
  facebook: IconFacebook,
  tiktok: IconTiktok,
  whatsapp: IconWhatsapp,
  telegram: IconTelegram,
  x: IconX,
  onlyfans: IconOnlyfans,
  privacy: IconPrivacy,
  threads: IconThreads,
  youtube: IconYoutube,
  email: IconMail,
  outro: IconDot,
};

export default function NetworkIcon({
  network,
  size = 14,
}: {
  network: SocialNetwork;
  size?: number;
}) {
  const Icon = NETWORK_ICON_MAP[network] || IconDot;
  return <Icon size={size} />;
}
