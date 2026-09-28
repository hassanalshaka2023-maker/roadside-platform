import {
  BatteryCharging,
  Car,
  CircleDot,
  Fuel,
  KeyRound,
  ShieldCheck,
  Truck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/** Slug -> icon. Kept in code rather than the database: icons are code. */
const SERVICE_ICONS: Record<string, LucideIcon> = {
  towing: Truck,
  battery: BatteryCharging,
  "tire-change": CircleDot,
  "fuel-delivery": Fuel,
  lockout: KeyRound,
  "on-site-mechanic": Wrench,
  "pre-purchase-inspection": ShieldCheck,
};

export function serviceIcon(slug: string): LucideIcon {
  return SERVICE_ICONS[slug] ?? Car;
}
