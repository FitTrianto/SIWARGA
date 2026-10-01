import { tenant } from "./tenant";

export interface RtUser {
  id: string;
  name: string;
  role: "ketua" | "sekretaris" | "bendahara" | "admin";
  rt: string;
  rw: string;
  isAuthorized: boolean;
}

// RT/RW selalu mengikuti tenant.ts — jangan hardcode nilai di sini.
const currentUser: RtUser = {
  id: "rt-001",
  name: "Bpk. Joko Santoso",
  role: "ketua",
  rt: tenant.rt,
  rw: tenant.rw,
  isAuthorized: true,
};

export function getCurrentRtUser(): RtUser {
  return currentUser;
}

export function isRtAuthorized(): boolean {
  return currentUser.isAuthorized;
}

export function getRtLabel(): string {
  return tenant.label;
}
