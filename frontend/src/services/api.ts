// Use Wails v3 generated type-safe bindings
import {
  LinksysService,
  ConnectionResult,
  RouterInfoData,
  FirmwareUpdateData,
  DeviceData,
  LANSettingsData,
  DHCPReservationData,
  RouterOverviewData,
  WANStatusData,
  SystemHealthData,
} from '../../bindings/linkbootergui';

// Re-export the generated types for convenience
export type {
  ConnectionResult,
  RouterInfoData,
  FirmwareUpdateData,
  DeviceData,
  LANSettingsData,
  DHCPReservationData,
  RouterOverviewData,
  WANStatusData,
  SystemHealthData,
};

export const api = {
  async connect(host: string, pass: string): Promise<ConnectionResult> {
    const res = await LinksysService.Connect(host, pass);
    return res as ConnectionResult;
  },

  async isConnected(): Promise<boolean> {
    return await LinksysService.IsConnected();
  },

  async getConnectedHost(): Promise<string> {
    return await LinksysService.GetConnectedHost();
  },

  async pingRouter(): Promise<boolean> {
    return await LinksysService.PingRouter();
  },

  async disconnect(): Promise<void> {
    await LinksysService.Disconnect();
  },

  async getRouterInfo(): Promise<RouterInfoData> {
    const res = await LinksysService.GetRouterInfo();
    return res as RouterInfoData;
  },

  async checkFirmwareUpdate(): Promise<FirmwareUpdateData> {
    const res = await LinksysService.CheckFirmwareUpdate();
    return res as FirmwareUpdateData;
  },

  async getRouterOverview(): Promise<RouterOverviewData> {
    const res = await LinksysService.GetRouterOverview();
    return res as RouterOverviewData;
  },

  async getWANStatus(): Promise<WANStatusData> {
    const res = await LinksysService.GetWANStatus();
    return res as WANStatusData;
  },

  async getSystemHealth(): Promise<SystemHealthData> {
    const res = await LinksysService.GetSystemHealth();
    return res as SystemHealthData;
  },

  async rebootRouter(): Promise<void> {
    await LinksysService.RebootRouter();
  },

  async triggerFirmwareUpdate(): Promise<void> {
    await LinksysService.TriggerFirmwareUpdate();
  },

  async getConnectedDevices(): Promise<DeviceData[]> {
    const res = await LinksysService.GetConnectedDevices();
    return (res || []) as DeviceData[];
  },

  async getPasswordHint(): Promise<string> {
    return await LinksysService.GetPasswordHint();
  },

  async changeAdminPassword(newPass: string, hint: string): Promise<void> {
    await LinksysService.ChangeAdminPassword(newPass, hint);
  },

  async getDHCPReservations(): Promise<LANSettingsData> {
    const res = await LinksysService.GetDHCPReservations();
    return res as LANSettingsData;
  },

  async addDHCPReservation(macAddress: string, ipAddress: string, description: string): Promise<LANSettingsData> {
    const res = await LinksysService.AddDHCPReservation(macAddress, ipAddress, description);
    return res as LANSettingsData;
  },

  async updateDHCPReservation(
    originalMACAddress: string,
    macAddress: string,
    ipAddress: string,
    description: string
  ): Promise<LANSettingsData> {
    const res = await LinksysService.UpdateDHCPReservation(originalMACAddress, macAddress, ipAddress, description);
    return res as LANSettingsData;
  },

  async deleteDHCPReservation(macAddress: string): Promise<LANSettingsData> {
    const res = await LinksysService.DeleteDHCPReservation(macAddress);
    return res as LANSettingsData;
  }
};
