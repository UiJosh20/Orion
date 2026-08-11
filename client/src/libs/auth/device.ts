const STORAGE_KEY = 'orion_device_uuid';

/**
 * Retrieves the existing anonymous device UUID from localStorage
 * or creates and stores a new RFC4122 UUID v4 if none exists.
 */
export function getOrCreateDeviceUuid(): string {
  // Prevent execution on server-side rendering (SSR)
  if (typeof window === 'undefined') return '';

  let deviceUuid = localStorage.getItem(STORAGE_KEY);

  if (!deviceUuid) {
    // Generates a cryptographically secure UUID v4
    deviceUuid = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY, deviceUuid);
  }

  return deviceUuid;
}