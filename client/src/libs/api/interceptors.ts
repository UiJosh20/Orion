import { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { ENDPOINTS } from '@/src/constants/endpoints';
import { getOrCreateDeviceUuid } from '../auth/device';

let isRefreshing = false;
let failedQueue: Array<{
  resolve: () => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: any) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });
  failedQueue = [];
};

export function setupInterceptors(apiClient: AxiosInstance): AxiosInstance {
  // 1. Request Interceptor
  apiClient.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      if (typeof window !== 'undefined') {
        const deviceUuid = getOrCreateDeviceUuid();

        // Attach X-Device-UUID using standard Axios 1.x header methods
        if (deviceUuid && config.headers && !config.headers.has('X-Device-UUID')) {
          config.headers.set('X-Device-UUID', deviceUuid);
        }
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  // 2. Response Interceptor (Auto-Refresh on 401)
  apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      if (error.response?.status === 401 && !originalRequest._retry) {
        if (originalRequest.url === ENDPOINTS.AUTH.REFRESH) {
          localStorage.setItem('orion_is_logged_in', 'false');
          return Promise.reject(error);
        }

        if (isRefreshing) {
          return new Promise<void>((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then(() => apiClient(originalRequest))
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          await apiClient.post(ENDPOINTS.AUTH.REFRESH);
          localStorage.setItem('orion_is_logged_in', 'true');
          processQueue(null);
          return apiClient(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError);
          localStorage.setItem('orion_is_logged_in', 'false');
          return Promise.reject(refreshError);
        } finally {
          isRefreshing = false;
        }
      }

      return Promise.reject(error);
    }
  );

  return apiClient;
}