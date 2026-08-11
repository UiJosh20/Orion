import { ENDPOINTS } from "../constants/endpoints";
import { api } from "../libs/api/client";

export interface AlertItem {
  id: number;
  user_id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT';
  threshold_value: number;
  is_active: boolean;
  is_triggered: boolean;
  created_at?: string;
}

export interface CreateAlertPayload {
  userId: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW' | 'RSI_OVERSOLD' | 'RSI_OVERBOUGHT';
  thresholdValue: number;
}

export const alertService = {
  /**
   * Fetch all user alerts
   */
  getAlerts: async (): Promise<AlertItem[]> => {
    const response = await api.get(ENDPOINTS.ALERTS.BASE);
    return response.data;
  },

  /**
   * Create a new price or indicator alert
   */
  createAlert: async (data: CreateAlertPayload): Promise<AlertItem> => {
    const response = await api.post(ENDPOINTS.ALERTS.BASE, data);
    return response.data;
  },

  /**
   * Toggle an alert active/inactive state
   */
  toggleAlert: async (id: number | string): Promise<void> => {
    await api.patch(ENDPOINTS.ALERTS.TOGGLE(id));
  },

  /**
   * Delete an existing alert
   */
  deleteAlert: async (id: number | string): Promise<void> => {
    await api.delete(ENDPOINTS.ALERTS.DELETE(id));
  },
};