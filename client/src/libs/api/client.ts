import axios from 'axios';
import { setupInterceptors } from './interceptors';

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ,
  timeout: 15000,
  withCredentials: true, // 👈 Required for HttpOnly cookies
  headers: {
    'Content-Type': 'application/json',
  },
});

export const api = setupInterceptors(apiClient);