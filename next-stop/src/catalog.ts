// Shared with the server: the amenity, vehicle-feature and cancel-reason vocabularies.
import catalog from '../server/catalog.json';
import type { IconName } from './components/UI';

export const amenityLabels: Record<string, string> = catalog.amenities;
export const vehicleFeatureLabels: Record<string, string> = catalog.vehicleFeatures;
export const cancelReasonLabels: Record<string, string> = catalog.cancelReasons;
export const amenityIcons: Record<string, IconName> = {
  shelter: 'umbrella-outline',
  seating: 'albums-outline',
  lighting: 'bulb-outline',
  step_free: 'accessibility-outline',
  tactile_paving: 'footsteps-outline',
  curb_ramp: 'accessibility-outline',
  bike_parking: 'bicycle-outline',
  display: 'tv-outline',
  emergency_phone: 'call-outline',
  restroom_nearby: 'male-female-outline',
  indoor_waiting: 'business-outline',
};
