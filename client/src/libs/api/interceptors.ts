import { AxiosInstance, InternalAxiosRequestConfig, AxiosError } from 'axios';
import { ENDPOINTS } from '@/src/constants/endpoints';
import { getOrCreateDeviceUuid } from '../auth/device';


let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
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
        if (deviceUuid && config.headers) {
          config.headers['X-Device-UUID'] = deviceUuid;
        }

        const token = localStorage.getItem('access_token');
        if (token && config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
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
          // If refresh itself fails, clear session
          localStorage.removeItem('access_token');
          return Promise.reject(error);
        }

        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject });
          })
            .then((token) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              return apiClient(originalRequest);
            })
            .catch((err) => Promise.reject(err));
        }

        originalRequest._retry = true;
        isRefreshing = true;

        try {
          // Call refresh route (Browser auto-sends HttpOnly Cookie)
          const { data } = await apiClient.post(ENDPOINTS.AUTH.REFRESH);
          const newAccessToken = data.accessToken;

          localStorage.setItem('access_token', newAccessToken);

          apiClient.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          }

          processQueue(null, newAccessToken);
          return apiClient(originalRequest);
        } catch (refreshError) {
          processQueue(refreshError, null);
          localStorage.removeItem('access_token');
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