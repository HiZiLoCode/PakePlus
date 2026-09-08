const { session } = require("electron");

class HIDManager {
  constructor() {
    this.authorizedDevices = new Set();
    this.deviceCallbacks = new Set();
    this.vendorId = 0x36b0; // 键盘 / 接收器 VID
    this.pidStart = 0x3002; // 标准 2.4G Dongle 起始 PID
    this.pidEnd = 0x352f; // 结束 PID
    this.extraReceiverPids = [0x5002]; // 5002 接收器
    this.deviceChangeTimers = new Map();
    this.connectedDevices = new Map();
    this.receivedData = [];
    this.init();
    this.addState = false;
  }

  init() {
    const ses = session.defaultSession;

    ses.setDevicePermissionHandler((details) => {
      return this.isDeviceAuthorized(details.device);
    });

    ses.on("select-hid-device", (event, details, callback) => {
      event.preventDefault();
      this.handleDeviceSelection(details, callback);
    });

    ses.on("hid-device-added", (event, device) => {
      this.handleDeviceAdded(device);
    });

    ses.on("hid-device-removed", (event, device) => {
      this.handleDeviceRemoved(device);
    });

    ses.setPermissionCheckHandler(
      (webContents, permission, requestingOrigin) => {
        return permission === "hid" && requestingOrigin === "file:///";
      }
    );
  }

  getDeviceKey(device) {
    return `${device.vendorId.toString(16)}_${device.productId.toString(16)}`;
  }

  isDeviceAuthorized(device) {
    return this.authorizedDevices.has(this.getDeviceKey(device));
  }

  isValidDevice(device) {
    if (device.vendorId !== this.vendorId) return false;
    if (
      device.productId >= this.pidStart &&
      device.productId <= this.pidEnd
    ) {
      return true;
    }
    return this.extraReceiverPids.includes(device.productId);
  }

  handleDeviceSelection(details, callback) {
    if (!details.deviceList || details.deviceList.length === 0) {
      console.log("没有可用的 HID 设备");
      callback(null);
      return;
    }

    const targetDevices = details.deviceList.filter((device) =>
      this.isValidDevice(device)
    );

    if (targetDevices.length > 0) {
      console.log(
        `找到 ${targetDevices.length} 个符合条件的设备:`,
        targetDevices
      );

      targetDevices.forEach((device) => {
        this.authorizedDevices.add(this.getDeviceKey(device));
        this.notifyDeviceCallbacks("deviceAdded", device);
      });

      callback(targetDevices[0].deviceId);
    } else {
      console.log("未找到符合条件的设备");
      callback(null);
    }
  }

  async handleDeviceAdded(device) {
    const deviceKey = this.getDeviceKey(device.device);

    if (this.deviceChangeTimers.has(deviceKey)) {
      clearTimeout(this.deviceChangeTimers.get(deviceKey));
      this.deviceChangeTimers.delete(deviceKey);
    }

    if (this.isValidDevice(device.device)) {
      if (!this.isDeviceAuthorized(device.device)) {
        this.authorizedDevices.add(deviceKey);
        this.notifyDeviceCallbacks("deviceAdded", device.device);
        this.addState = true;
        this.connectedDevices.set(deviceKey, device.device);
        console.log("device", device.device);
      } else {
        console.log(`设备已授权: ${deviceKey}`);
      }
    } else {
      console.log(`设备不符合要求: ${deviceKey}`);
    }
  }

  handleDeviceRemoved(device) {
    const deviceKey = this.getDeviceKey(device.device);
    this.connectedDevices.delete(deviceKey);
    this.receivedData = [];

    if (this.authorizedDevices.has(deviceKey)) {
      if (this.deviceChangeTimers.has(deviceKey)) {
        clearTimeout(this.deviceChangeTimers.get(deviceKey));
      }

      const timer = setTimeout(() => {
        if (this.addState) {
          this.addState = false;
          return;
        }
        this.authorizedDevices.delete(deviceKey);
        this.notifyDeviceCallbacks("deviceRemoved", device.device);
        this.deviceChangeTimers.delete(deviceKey);
      }, 500);
      this.deviceChangeTimers.set(deviceKey, timer);
    }
  }

  onDeviceChange(callback) {
    this.deviceCallbacks.add(callback);
    return () => this.deviceCallbacks.delete(callback);
  }

  notifyDeviceCallbacks(event, device) {
    this.deviceCallbacks.forEach((callback) => {
      try {
        callback(event, device);
      } catch (error) {
        console.error("设备回调执行错误:", error);
      }
    });
  }

  getAuthorizedDevices() {
    return Array.from(this.authorizedDevices);
  }

  clearAuthorizedDevices() {
    this.authorizedDevices.clear();
    this.deviceChangeTimers.forEach((timer) => clearTimeout(timer));
    this.deviceChangeTimers.clear();
  }
}

module.exports = HIDManager;
