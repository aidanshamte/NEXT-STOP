import type { Institution, RequestStatus, Role } from '../../domain';

export interface Me {
  user: {
    id: string;
    name: string;
    email: string;
    email_verified?: number;
    google_linked?: number;
    password_enabled?: number;
  };
  memberships: Institution[];
}

/** Runs an authenticated institution-scoped write, then refreshes and reports success. */
export type Mutate = (path: string, body: object, success: string) => Promise<void>;
/** Runs a busy-guarded action and reports thrown errors to the workspace notice. */
export type Run = (action: () => Promise<void>) => Promise<void>;

export const roleLabels: Record<Role, string> = {
  student: 'Student',
  driver: 'Driver',
  parent: 'Parent',
  admin: 'Dispatch',
};

export const statusLabels: Record<RequestStatus, string> = {
  requested: 'Pickup requested',
  accepted: 'Driver accepted',
  boarded: 'Onboard shuttle',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
};
