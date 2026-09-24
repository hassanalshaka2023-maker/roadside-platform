/**
 * Who may see and bid on a request.
 *
 * Pure: the database query in ./queries.ts narrows the candidates cheaply,
 * and this function makes the final, exhaustively tested decision. Offer
 * submission re-runs it inside the transaction, so a provider who was
 * suspended or went offline a second ago cannot slip an offer in.
 */
import { distanceKm } from "@/lib/geo";

export interface ProviderCandidate {
  userId: string;
  userStatus: "ACTIVE" | "SUSPENDED" | "BLOCKED";
  profileStatus: "ACTIVE" | "INACTIVE" | "SUSPENDED";
  isAvailable: boolean;
  serviceTypeIds: readonly string[];
  lat: number | null;
  lng: number | null;
  serviceRadiusKm: number;
  towCapacities: readonly string[];
  /** True while the provider is booked on another unfinished job. */
  hasActiveJob: boolean;
}

export interface RequestForMatching {
  customerId: string;
  serviceTypeId: string;
  lat: number;
  lng: number;
  requiresDestination: boolean;
  carCategory: string | null;
}

export type IneligibleReason =
  | "NOT_ACTIVE"
  | "NOT_AVAILABLE"
  | "BUSY"
  | "OWN_REQUEST"
  | "SERVICE_MISMATCH"
  | "NO_BASE_LOCATION"
  | "OUT_OF_RANGE"
  | "CAPACITY_MISMATCH";

export type Eligibility =
  | { eligible: true; distanceKm: number }
  | { eligible: false; reason: IneligibleReason };

export function checkEligibility(
  provider: ProviderCandidate,
  request: RequestForMatching,
  options: {
    platformRadiusKm: number;
    /** An admin invited this provider directly: distance and the
     *  availability toggle are waived, everything else still applies. */
    invited?: boolean;
  },
): Eligibility {
  // Approval and suspension are never waived, not even by an invitation.
  if (provider.userStatus !== "ACTIVE" || provider.profileStatus !== "ACTIVE") {
    return { eligible: false, reason: "NOT_ACTIVE" };
  }
  if (provider.userId === request.customerId) {
    return { eligible: false, reason: "OWN_REQUEST" };
  }
  if (!provider.serviceTypeIds.includes(request.serviceTypeId)) {
    return { eligible: false, reason: "SERVICE_MISMATCH" };
  }
  if (provider.hasActiveJob) {
    return { eligible: false, reason: "BUSY" };
  }
  if (!options.invited && !provider.isAvailable) {
    return { eligible: false, reason: "NOT_AVAILABLE" };
  }
  // A tow truck must be able to carry this kind of vehicle. An unknown
  // category is not held against anyone: the customer did not say.
  if (
    request.requiresDestination &&
    request.carCategory !== null &&
    provider.towCapacities.length > 0 &&
    !provider.towCapacities.includes(request.carCategory)
  ) {
    return { eligible: false, reason: "CAPACITY_MISMATCH" };
  }
  if (provider.lat === null || provider.lng === null) {
    return options.invited
      ? { eligible: true, distanceKm: 0 }
      : { eligible: false, reason: "NO_BASE_LOCATION" };
  }

  const distance = distanceKm({ lat: provider.lat, lng: provider.lng }, request);
  const limit = Math.min(provider.serviceRadiusKm, options.platformRadiusKm);

  if (!options.invited && distance > limit) {
    return { eligible: false, reason: "OUT_OF_RANGE" };
  }

  return { eligible: true, distanceKm: distance };
}

/**
 * A rough lat/lng box around a point, for narrowing the SQL query before the
 * exact distance check. One degree of latitude is ~111 km; longitude degrees
 * shrink with latitude, so the box is widened accordingly.
 */
export function boundingBox(center: { lat: number; lng: number }, radiusKm: number) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}
